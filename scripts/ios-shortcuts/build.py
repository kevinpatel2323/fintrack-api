#!/usr/bin/env python3
"""Builds and signs the two iPhone shortcuts that feed transaction memos.

  Fintrack Memos     runs on every incoming message (iOS automation). Bank SMS
                     only: it filters on the phone (OTPs and personal messages
                     never leave it), saves the SMS to an iCloud outbox, asks for
                     the memo, then sends everything waiting to the API.
                     Typed input: fintrack:pair:<code> pairs the phone,
                     fintrack:send-pending sends the outbox, fintrack:test:<sms>
                     dry-runs the filter.
  Add Fintrack memo  lists this phone's last-24 h memos still blank and sets one.

The on-phone filter (filter-block.json) is the proven message filter the first
version of this capture used; it is copied in unchanged. Everything else is
generated here. Every request goes to the one API_BASE baked in at build time.

Usage (macOS, signed in to iCloud):
  python3 -I scripts/ios-shortcuts/build.py --api https://fintrack-api-dev.vercel.app \
      --out ~/Downloads/Fintrack-Memos
"""
import argparse
import json
import os
import plistlib
import re
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
OBJ = '￼'
SHORTCUT_VERSION = '2.0'
KEY_PATTERN = r'^fintrack_[A-Za-z0-9_-]{43}$'
# The imported shortcut this grew from. Hex so the name never appears in our own
# source; the build refuses any output that still contains it.
THIRD_PARTY_NAME = bytes.fromhex('6d756e696d').decode()

INPUT_CLASSES = [
    'WFAppContentItem', 'WFAppStoreAppContentItem', 'WFArticleContentItem', 'WFContactContentItem',
    'WFDateContentItem', 'WFEmailAddressContentItem', 'WFFolderContentItem', 'WFGenericFileContentItem',
    'WFImageContentItem', 'WFiTunesProductContentItem', 'WFLocationContentItem', 'WFDCMapsLinkContentItem',
    'WFAVAssetContentItem', 'WFPDFContentItem', 'WFPhoneNumberContentItem', 'WFRichTextContentItem',
    'WFSafariWebPageContentItem', 'WFStringContentItem', 'WFURLContentItem', 'WFDictionaryContentItem',
    'WFNumberContentItem',
]


def nid():
    return str(uuid.uuid4())


# ── References and text tokens ─────────────────────────────────────────────

class Out:
    """An action's output, referenced as a magic variable."""

    def __init__(self, uid, name):
        self.uid, self.name = uid, name

    def ref(self):
        return {'Type': 'ActionOutput', 'OutputUUID': self.uid, 'OutputName': self.name}


def V(name):
    return {'Type': 'Variable', 'VariableName': name}


def EI(prop=None):
    ref = {'Type': 'ExtensionInput', 'VariableName': 'ShortcutInput'}
    if prop:
        ref['Aggrandizements'] = [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': prop}]
    return ref


def _ref(part):
    return part.ref() if isinstance(part, Out) else part


def tokens(*parts):
    text, att = '', {}
    for part in parts:
        if isinstance(part, str):
            text += part
        else:
            # Ranges are UTF-16 offsets, as NSString counts them.
            att[f'{{{len(text.encode("utf-16-le")) // 2}, 1}}'] = _ref(part)
            text += OBJ
    value = {'string': text}
    if att:
        value['attachmentsByRange'] = att
    return {'Value': value, 'WFSerializationType': 'WFTextTokenString'}


def textparam(*parts):
    """A plain string when there is nothing to interpolate, else a token string."""
    if all(isinstance(p, str) for p in parts):
        return ''.join(parts)
    return tokens(*parts)


def attach(part):
    return {'Value': _ref(part), 'WFSerializationType': 'WFTextTokenAttachment'}


def dict_items(items):
    out = []
    for key, value in items:
        item = {'WFKey': tokens(key)}
        if isinstance(value, list):  # nested dictionary
            item['WFItemType'] = 1
            item['WFValue'] = {
                'Value': {'Value': {'WFDictionaryFieldValueItems': dict_items(value)}, 'WFSerializationType': 'WFDictionaryFieldValue'},
                'WFSerializationType': 'WFDictionaryFieldValue',
            }
        else:
            item['WFItemType'] = 0
            item['WFValue'] = tokens(*(value if isinstance(value, tuple) else (value,)))
        out.append(item)
    return out


# ── Builder ────────────────────────────────────────────────────────────────

class Shortcut:
    def __init__(self):
        self.actions = []
        self.stack = []
        self.counter = 0

    def name(self, base='Text'):
        self.counter += 1
        return f'{base} {self.counter}'

    def act(self, ident, out=None, **params):
        p = dict(params)
        result = None
        if out is not None:
            uid = nid()
            p['UUID'] = uid
            p['CustomOutputName'] = out
            result = Out(uid, out)
        self.actions.append({'WFWorkflowActionIdentifier': f'is.workflow.actions.{ident}', 'WFWorkflowActionParameters': p})
        return result

    # values
    def text(self, *parts, out=None):
        return self.act('gettext', out or self.name(), WFTextActionText=textparam(*parts))

    def number(self, n, out=None):
        return self.act('number', out or self.name('Number'), WFNumberActionNumber=n)

    def setvar(self, var, src):
        self.act('setvariable', WFInput=attach(src), WFVariableName=var, WFSerializationType='WFTextTokenAttachment')

    def settext(self, var, *parts):
        self.setvar(var, self.text(*parts))

    def add_one(self, var):
        self.setvar(var, self.act('math', self.name('Number'), WFInput=attach(V(var)), WFMathOperand=1, WFMathOperation='+'))

    # control flow
    def if_(self, src, cond, text=None, number=None):
        group = nid()
        p = {'WFInput': {'Type': 'Variable', 'Variable': attach(src)}, 'WFControlFlowMode': 0,
             'GroupingIdentifier': group, 'WFCondition': cond}
        if text is not None:
            p['WFConditionalActionString'] = textparam(*(text if isinstance(text, tuple) else (text,)))
        if number is not None:
            p['WFNumberValue'] = number
        self.actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.conditional', 'WFWorkflowActionParameters': p})
        self.stack.append(('conditional', group))

    def each(self, src):
        group = nid()
        self.actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.repeat.each', 'WFWorkflowActionParameters': {
            'WFInput': attach(src), 'GroupingIdentifier': group, 'WFControlFlowMode': 0}})
        self.stack.append(('repeat.each', group))

    def end(self):
        kind, group = self.stack.pop()
        self.actions.append({'WFWorkflowActionIdentifier': f'is.workflow.actions.{kind}', 'WFWorkflowActionParameters': {
            'UUID': nid(), 'GroupingIdentifier': group, 'WFControlFlowMode': 2}})

    # text
    def replace(self, src, find, repl, case=True):
        return self.act('text.replace', self.name('ReplaceText'), WFReplaceTextReplace=repl, WFReplaceTextRegularExpression=True,
                        WFReplaceTextFind=find, WFReplaceTextCaseSensitive=case, WFInput=tokens(src))

    def match(self, src, pattern, case=True):
        return self.act('text.match', self.name('Matches'), WFMatchTextPattern=pattern, WFMatchTextCaseSensitive=case, text=tokens(src))

    def count(self, src, chars=False):
        extra = {'WFCountType': 'Characters'} if chars else {}
        return self.act('count', self.name('Count'), Input=attach(src), **extra)

    # dates
    def fmt_date(self, date, *fmt):
        return self.act('format.date', self.name('FormattedDate'), WFDateFormatStyle='Custom', WFTimeFormatStyle='None',
                        WFDateFormat=textparam(*fmt), WFDate=tokens(date))

    # files (paths are relative to iCloud Drive › Shortcuts)
    def get_file(self, *path, must_exist=False):
        return self.act('documentpicker.open', self.name('File'), WFFileErrorIfNotFound=must_exist, WFGetFilePath=textparam(*path))

    def save_file(self, src, *path):
        return self.act('documentpicker.save', self.name('SavedFile'), WFAskWhereToSave=False, WFInput=attach(src),
                        WFFileDestinationPath=textparam(*path), WFSaveFileOverwrite=True)

    def delete(self, src):
        self.act('file.delete', WFDeleteFileConfirmDeletion=False, WFInput=attach(src), WFDeleteImmediatelyDelete=True)

    def folder_files(self, *path):
        folder = self.get_file(*path, must_exist=True)
        return self.act('file.getfoldercontents', self.name('Files'), WFFolder=attach(folder))

    def ensure_folder(self, path):
        found = self.count(self.get_file(path))
        self.if_(found, 4, number=0)
        self.act('file.createfolder', WFFilePath=path)
        self.end()

    # dictionaries and JSON
    def dictionary(self, items):
        return self.act('dictionary', self.name('Dictionary'), WFItems={
            'Value': {'WFDictionaryFieldValueItems': dict_items(items)}, 'WFSerializationType': 'WFDictionaryFieldValue'})

    def get_value(self, src, key):
        return self.act('getvalueforkey', self.name('Value'), WFInput=attach(src), WFGetDictionaryValueType='Value', WFDictionaryKey=key)

    def set_value(self, dict_var, key, *value):
        result = self.act('setvalueforkey', self.name('SetValue'), WFDictionary=attach(V(dict_var)), WFDictionaryKey=key,
                          WFDictionaryValue=tokens(*value))
        self.setvar(dict_var, result)

    def read_json(self, src):
        return self.act('detect.dictionary', self.name('Dictionary'), WFInput=attach(src))

    # network: every request goes to the pinned API_BASE
    def request(self, api_base, path, method, body_file=None, key_var=None):
        headers = [('Content-Type', 'application/json')] if body_file is not None else []
        if key_var:
            headers.append(('Authorization', ('Bearer ', V(key_var))))
        params = {
            'WFURL': tokens(api_base, path), 'WFHTTPMethod': method, 'ShowHeaders': True,
            'WFHTTPHeaders': {'Value': {'WFDictionaryFieldValueItems': dict_items(headers)}, 'WFSerializationType': 'WFDictionaryFieldValue'},
        }
        if body_file is not None:
            params.update(WFHTTPBodyType='File', WFRequestVariable=attach(body_file))
        return self.act('downloadurl', self.name('Reply'), **params)

    # UI
    def alert(self, *message, cancel=False, title='Fintrack Memos'):
        self.act('alert', WFAlertActionTitle=title, WFAlertActionMessage=textparam(*message), WFAlertActionCancelButtonShown=cancel)

    def notify(self, *body, title='Fintrack Memos'):
        self.act('notification', WFNotificationActionTitle=title, WFNotificationActionBody=textparam(*body), WFNotificationActionSound=False)

    def ask(self, *prompt):
        return self.act('ask', self.name('Provided Input'), WFInputType='Text', WFAskActionPrompt=textparam(*prompt))

    def output(self, *parts):
        self.act('output', WFOutput=textparam(*parts))

    def finish(self):
        assert not self.stack, f'unclosed blocks: {self.stack}'
        return self.actions


# ── Fintrack Memos ─────────────────────────────────────────────────────────

def build_memos(api: str) -> list:
    s = Shortcut()
    filter_block = json.loads((HERE / 'filter-block.json').read_text())

    # Settings. The filter block reads MESSAGE_DETAILS and ISO_FORMAT by these ids.
    API = s.text(api, out='API_BASE')
    LOCATION = s.text('on', out='LOCATION')
    s.actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext', 'WFWorkflowActionParameters': {
        'UUID': '0f82d603-3c36-4fae-ac88-0474ba8bc2d1', 'CustomOutputName': 'MESSAGE_DETAILS', 'WFTextActionText': 'on'}})
    ISO = Out('914a6d48-9d98-4618-852b-bb5cb4091097', 'ISO_FORMAT')
    s.actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext', 'WFWorkflowActionParameters': {
        'UUID': ISO.uid, 'CustomOutputName': ISO.name, 'WFTextActionText': "yyyy-MM-dd'T'HH:mm:ssZZZZZ"}})
    VERSION = s.text(SHORTCUT_VERSION, out='SHORTCUT_VERSION')
    FILTER_VERSION = s.text('1', out='FILTER_VERSION')
    CONNECTION = s.text('Fintrack/connection.txt', out='CONNECTION_FILE')

    for var, value in [('sender', ''), ('receivedAt', ''), ('token', ''), ('status', 'none'), ('halt', 'no'),
                       ('notConnected', 'no'), ('connected', 'no'), ('cfgLocation', 'off'), ('paired', 'no')]:
        s.settext(var, value)
    s.setvar('sentCount', s.number(0))
    s.setvar('failedCount', s.number(0))

    # What started us: a message (automation) or typed text (a command or a pasted SMS).
    kind = s.act('getitemtype', 'inputKind', WFInput=attach(EI()))
    s.settext('inputType', kind)
    s.settext('raw', EI())
    s.setvar('body', V('raw'))
    s.settext('mode', 'capture')
    s.if_(V('inputType'), 5, text='Message')
    s.if_(V('raw'), 4, text='fintrack:send-pending')
    s.settext('mode', 'flush')
    s.end()
    s.if_(V('raw'), 8, text='fintrack:test:')
    s.settext('mode', 'test')
    s.setvar('body', s.replace(V('raw'), '^fintrack:test:', ''))
    s.end()
    s.if_(V('raw'), 8, text='fintrack:pair:')
    s.settext('mode', 'pair')
    s.end()
    s.end()
    s.settext('filtered', 'no')
    s.if_(V('mode'), 4, text='capture')
    s.settext('filtered', 'yes')
    s.end()
    s.if_(V('mode'), 4, text='test')
    s.settext('filtered', 'yes')
    s.end()

    s.setvar('now', s.act('date', 'CurrentDate', WFDateActionMode='Current Date'))
    s.setvar('today', s.fmt_date(V('now'), 'yyyyMMdd'))

    # Folders first: reading a file whose folder is missing fails even when told not to.
    for folder in ['Fintrack', 'Fintrack/outbox', 'Fintrack/failed', 'Fintrack/notified']:
        s.ensure_folder(folder)

    def notify_once(kind_name, *body):
        marker = s.count(s.get_file('Fintrack/notified/', V('today'), f'-{kind_name}.txt'))
        s.if_(marker, 4, number=0)
        s.notify(*body)
        s.save_file(s.text('shown'), 'Fintrack/notified/', V('today'), f'-{kind_name}.txt')
        s.end()

    # ── Pair: trade the one-time code from the Memos page for this phone's key ──
    s.if_(V('mode'), 4, text='pair')
    code = s.replace(s.replace(V('raw'), '^fintrack:pair:', '', case=False), '[^A-Za-z0-9]', '')
    host = s.replace(API, '^https?://', '')
    s.alert('Connect this iPhone to Fintrack (', host, ')? Bank and card SMS will be sent there with the memo you type. '
            'OTPs and personal messages never leave this iPhone.', cancel=True)
    request_file = s.save_file(s.text(s.dictionary([('code', (code,))])), 'Fintrack/pair-request.json')
    # Left in place (overwritten next time): it only holds a code that is spent
    # once used, and deleting it would cost a confirmation prompt.
    reply = s.request(API, '/api/v1/devices/pair', 'POST', body_file=request_file)
    s.settext('newKey', s.get_value(s.read_json(reply), 'key'))
    key_ok = s.count(s.match(V('newKey'), KEY_PATTERN))
    s.if_(key_ok, 4, number=0)
    s.alert("That code didn't work. In Fintrack, open Memos and press Connect iPhone for a new code "
            '(each lasts 10 minutes), then run this shortcut again and type the new line.')
    s.output('pair-failed')
    s.end()
    s.save_file(s.text(s.dictionary([('token', (V('newKey'),)), ('location', 'off')])), CONNECTION)
    s.settext('savedConfig', s.get_file(CONNECTION))
    s.if_(V('savedConfig'), 999, text=(V('newKey'),))
    s.alert('Fintrack paired this iPhone, but the shortcut could not save it in iCloud Drive › Shortcuts › Fintrack. '
            'Check that iCloud Drive is on for Shortcuts, then pair again with a new code.')
    s.output('pair-not-saved')
    s.end()
    s.settext('token', V('newKey'))
    s.settext('connected', 'yes')
    s.settext('paired', 'yes')
    s.settext('mode', 'flush')
    s.if_(LOCATION, 4, text='on')
    s.alert("Next, iOS may ask for your location. Allow it to record where each payment happened, "
            "or choose Don't Allow to send without it.")
    here = s.act('getcurrentlocation', s.name('Location'))
    lat = s.act('properties.locations', s.name('Latitude'), WFInput=attach(here), WFContentItemPropertyName='Latitude')
    lat_ok = s.count(s.match(s.text(lat), r'^-?[0-9]+(\.[0-9]+)?$'))
    s.if_(lat_ok, 2, number=0)
    s.save_file(s.text(s.dictionary([('token', (V('newKey'),)), ('location', 'on')])), CONNECTION)
    s.settext('cfgLocation', 'on')
    s.end()
    s.end()
    s.end()

    # ── Filter (on the phone): OTPs and anything that isn't a bank transaction stop here ──
    reasons = {'never': 'it looks like an OTP or a code, which never leaves this iPhone.',
               'drop': "it doesn't look like a bank, UPI or card transaction."}
    for action in filter_block:
        if action['WFWorkflowActionIdentifier'] == 'is.workflow.actions.output':  # 'never' or 'drop'
            reason = reasons[action['WFWorkflowActionParameters']['WFOutput']]
            s.if_(V('mode'), 4, text='test')
            s.alert('Test: this message would NOT be sent: ', reason)
            s.end()
        s.actions.append(action)
    amount_hit = next(Out(a['WFWorkflowActionParameters']['UUID'], 'amountHit') for a in filter_block
                      if a.get('WFWorkflowActionParameters', {}).get('CustomOutputName') == 'amountHit')

    # ── Connection saved by pairing ──
    if_paired_before = s.count(s.get_file(CONNECTION))
    s.if_(if_paired_before, 2, number=0)
    config = s.read_json(s.text(s.get_file(CONNECTION)))
    s.settext('token', s.get_value(config, 'token'))
    s.settext('cfgLocation', s.get_value(config, 'location'))
    s.if_(V('token'), 8, text='fintrack_')
    s.settext('connected', 'yes')
    s.end()
    s.end()

    # ── Capture: save the SMS, ask for the memo, add the location ──
    s.if_(V('filtered'), 4, text='yes')
    amount_text = s.act('getitemfromlist', s.name('Amount'), WFInput=attach(amount_hit), WFItemSpecifier='First Item')
    s.settext('who', 'Bank SMS')
    s.if_(V('hasSender'), 4, text='yes')
    s.settext('who', V('sender'))
    s.end()
    s.if_(V('mode'), 4, text='test')
    s.alert('Test: this message would be sent (', amount_text, ' · ', V('who'), '). Nothing was saved or sent.')
    s.output('would-send')
    s.end()

    waiting_before = s.count(s.folder_files('Fintrack/outbox'))
    captured_at = s.fmt_date(V('now'), ISO)
    stamp = s.fmt_date(V('now'), "yyyyMMdd'T'HHmmss")
    rand = [s.act('number.random', s.name('Random'), WFRandomNumberMinimum=10000, WFRandomNumberMaximum=99999) for _ in range(3)]
    s.setvar('submissionId', s.replace(s.text(stamp, '-', rand[0], '-', rand[1], '-', rand[2]), '[^A-Za-z0-9._:-]', ''))
    s.settext('filePath', 'Fintrack/outbox/', V('submissionId'), '.json')
    s.setvar('payload', s.dictionary([
        ('filter', [('version', (FILTER_VERSION,)), ('senderRecognised', (V('senderRecognised'),))]),
        ('shortcutVersion', (VERSION,)),
        ('contractVersion', '1'),
        ('submissionId', (V('submissionId'),)),
        ('message', (V('body'),)),
        ('capturedAt', (captured_at,)),
        ('locationStatus', 'not read'),
        ('outboxCount', (waiting_before,)),
    ]))
    s.if_(V('hasSender'), 4, text='yes')
    s.set_value('payload', 'sender', V('sender'))
    s.end()
    s.if_(V('hasReceivedAt'), 4, text='yes')
    s.set_value('payload', 'receivedAt', V('receivedAt'))
    s.end()
    # Saved before anything that can fail (the prompt, location, network): from
    # here on the SMS cannot be lost.
    s.save_file(s.text(V('payload')), V('filePath'))

    # One line above the text box, the amount only ("₹10.00"); Done sends it.
    rupees = s.replace(amount_text, r'^(?:INR|Rs\.?|₹)\s*|^(?:debited|credited|withdrawn|deducted)\s+(?:by|for|with|of)\s+', '₹', case=False)
    answer = s.ask(rupees)
    s.settext('memoText', answer)
    memo_len = s.count(V('memoText'), chars=True)
    s.if_(memo_len, 2, number=0)
    s.set_value('payload', 'memo', V('memoText'))
    s.save_file(s.text(V('payload')), V('filePath'))
    s.end()

    s.if_(LOCATION, 4, text='on')
    s.if_(V('cfgLocation'), 4, text='on')
    s.if_(V('connected'), 4, text='yes')
    here = s.act('getcurrentlocation', s.name('Location'))
    lat = s.text(s.act('properties.locations', s.name('Latitude'), WFInput=attach(here), WFContentItemPropertyName='Latitude'))
    lon = s.text(s.act('properties.locations', s.name('Longitude'), WFInput=attach(here), WFContentItemPropertyName='Longitude'))
    lat_ok = s.count(s.match(lat, r'^-?[0-9]+(\.[0-9]+)?$'))
    lon_ok = s.count(s.match(lon, r'^-?[0-9]+(\.[0-9]+)?$'))
    s.if_(lat_ok, 2, number=0)
    s.if_(lon_ok, 2, number=0)
    s.set_value('payload', 'latitude', lat)
    s.set_value('payload', 'longitude', lon)
    s.set_value('payload', 'locationStatus', 'captured')
    s.save_file(s.text(V('payload')), V('filePath'))
    s.end()
    s.end()
    s.end()
    s.end()
    s.end()
    s.end()

    s.if_(V('connected'), 5, text='yes')
    notify_once('notpaired', 'This iPhone is not paired yet. Your bank messages are saved and will be sent after pairing: '
                'in Fintrack open Memos › Connect iPhone.')
    s.output('kept')
    s.end()

    # ── Offline? (message-triggered runs only) ──
    # Shortcuts cannot catch a failed request, so with no signal at all an SMS
    # run stops quietly here instead of erroring; its file is already saved.
    # Offline only when every reading agrees (no Wi-Fi name, no Wi-Fi signal,
    # exactly 0 cellular bars): anything unclear counts as online. Charger,
    # Wi-Fi, scheduled and manual runs (mode 'flush') always try to send, so a
    # misreading can never strand the queue.
    s.if_(V('mode'), 4, text='capture')
    s.settext('wifiName', s.act('getwifi', s.name('Network Details'), WFNetworkDetailsNetwork='Wi-Fi', WFWiFiDetail='Network Name'))
    s.settext('wifiSignal', s.act('getwifi', s.name('Network Details'), WFNetworkDetailsNetwork='Wi-Fi', WFWiFiDetail='RSSI'))
    s.settext('signalBars', s.act('getwifi', s.name('Network Details'), WFNetworkDetailsNetwork='Cellular',
                                  WFCellularDetail='Number of Signal Bars'))
    s.if_(s.count(V('wifiName'), chars=True), 4, number=0)
    s.if_(s.count(V('wifiSignal'), chars=True), 4, number=0)
    s.if_(V('signalBars'), 4, text='0')
    s.output('offline')
    s.end()
    s.end()
    s.end()
    s.end()

    # ── Send everything waiting, oldest first ──
    # No lock between runs: two SMS at once may both send the same file, and
    # the server's upsert by submissionId makes that harmless. The only delete
    # is the sent file itself (iOS asks unless Settings › Shortcuts › Advanced ›
    # Allow Deleting Without Confirmation is on).

    for _ in range(2):
        s.if_(V('halt'), 4, text='no')
        ordered = s.act('filter.files', s.name('Ordered'), WFContentItemInputParameter=attach(s.folder_files('Fintrack/outbox')),
                        WFContentItemSortProperty='Name', WFContentItemSortOrder='A to Z',
                        WFContentItemLimitEnabled=True, WFContentItemLimitNumber=25)
        s.each(ordered)
        s.setvar('outboxFile', V('Repeat Item'))
        s.if_(V('halt'), 4, text='no')
        for attempt in range(2):
            if attempt:
                # A blank or non-JSON reply (a cold start, a captive portal): one
                # more try after 2 s, then the file waits for the next trigger.
                s.if_(s.count(V('status'), chars=True), 4, number=0)
                s.act('delay', WFDelayTime=2)
            reply = s.request(API, '/api/v1/memos', 'POST', body_file=V('outboxFile'), key_var='token')
            reply_dict = s.read_json(reply)
            s.settext('status', s.get_value(reply_dict, 'status'))
            s.settext('statusCode', s.get_value(reply_dict, 'statusCode'))
            if attempt:
                s.end()
        s.settext('handled', 'no')
        for done in ('accepted', 'refused'):
            s.if_(V('status'), 4, text=done)
            s.delete(V('outboxFile'))
            s.add_one('sentCount')
            s.settext('handled', 'yes')
            s.end()
        s.if_(V('status'), 4, text='invalid')
        failed_name = s.act('getitemname', s.name('Name'), WFInput=attach(V('outboxFile')))
        s.save_file(V('outboxFile'), 'Fintrack/failed/', failed_name, '.json')
        s.delete(V('outboxFile'))
        s.add_one('failedCount')
        s.settext('handled', 'yes')
        s.end()
        # Anything else (retry, slow_down, not paired, a blank reply): keep the
        # file and stop sending until the next trigger.
        s.if_(V('handled'), 4, text='no')
        s.settext('halt', 'yes')
        s.if_(V('statusCode'), 4, text='404')
        s.settext('notConnected', 'yes')
        s.end()
        s.end()
        s.end()
        s.end()
        s.end()


    waiting = s.count(s.folder_files('Fintrack/outbox'))
    s.if_(V('notConnected'), 4, text='yes')
    notify_once('notpaired', 'This iPhone is no longer paired with Fintrack. Your bank messages are saved and will be '
                'sent after pairing again: in Fintrack open Memos › Connect iPhone.')
    s.end()
    s.if_(V('failedCount'), 2, number=0)
    s.notify(V('failedCount'), ' message(s) could not be read by Fintrack and were moved to iCloud Drive › Shortcuts › Fintrack › failed.')
    s.end()
    # Stuck queue: the oldest file (names start yyyyMMdd'T'HHmm) is from before
    # yesterday, i.e. something has waited over a day. Once a day at most.
    s.if_(waiting, 2, number=0)
    oldest = s.act('filter.files', s.name('Oldest'), WFContentItemInputParameter=attach(s.folder_files('Fintrack/outbox')),
                   WFContentItemSortProperty='Name', WFContentItemSortOrder='A to Z',
                   WFContentItemLimitEnabled=True, WFContentItemLimitNumber=1)
    s.settext('oldestName', s.act('getitemname', s.name('Name'), WFInput=attach(oldest)))
    day_ago = s.act('adjustdate', s.name('AdjustDate'), WFAdjustOperation='Subtract', WFDate=tokens(V('now')),
                    WFDuration={'Value': {'Unit': 'min', 'Magnitude': '1440'}, 'WFSerializationType': 'WFQuantityFieldValue'})
    s.setvar('yesterday', s.fmt_date(day_ago, 'yyyyMMdd'))
    s.settext('recent', 'no')
    for day in ('today', 'yesterday'):
        s.if_(V('oldestName'), 8, text=(V(day),))
        s.settext('recent', 'yes')
        s.end()
    s.if_(V('recent'), 4, text='no')
    since = s.replace(V('oldestName'), r'^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2}).*$', '$3/$2 $4:$5')
    notify_once('stuck', waiting, ' message(s) have been waiting to send since ', since,
                '. Check that this iPhone is online and still paired (Fintrack › Memos › Devices).')
    s.end()
    s.end()

    summary = s.text('Fintrack Memos: ', V('sentCount'), ' sent, ', waiting, ' waiting')
    s.if_(V('paired'), 4, text='yes')
    s.alert('This iPhone is paired with Fintrack. ', V('sentCount'), ' waiting message(s) were sent.')
    s.end()
    s.output(summary)
    return s.finish()


# ── Add Fintrack memo ──────────────────────────────────────────────────────

def build_add_memo(api: str) -> list:
    s = Shortcut()
    API = s.text(api, out='API_BASE')
    ISO = s.text("yyyy-MM-dd'T'HH:mm:ssZZZZZ", out='ISO_FORMAT')
    CONNECTION = s.text('Fintrack/connection.txt', out='CONNECTION_FILE')
    s.settext('token', '')
    s.settext('chosenId', '')

    found = s.count(s.get_file(CONNECTION))
    s.if_(found, 2, number=0)
    s.settext('token', s.get_value(s.read_json(s.text(s.get_file(CONNECTION))), 'token'))
    s.end()
    key_ok = s.count(s.match(V('token'), KEY_PATTERN))
    s.if_(key_ok, 4, number=0)
    s.alert('This iPhone is not paired yet. In Fintrack open Memos › Connect iPhone, then run Fintrack Memos and type the line it shows.')
    s.output('not-paired')
    s.end()

    pending = s.read_json(s.request(API, '/api/v1/memos/pending', 'GET', key_var='token'))
    rows = s.get_value(pending, 'data')
    s.if_(s.count(rows), 4, number=0)
    s.alert('Every bank message from the last 24 hours already has a memo. Older ones can be edited on the Memos page in Fintrack.')
    s.output('none')
    s.end()
    s.each(rows)
    s.act('appendvariable', WFVariableName='choices', WFInput=attach(s.get_value(V('Repeat Item'), 'summary')))
    s.end()
    picked = s.act('choosefromlist', s.name('Chosen Item'), WFInput=attach(V('choices')),
                   WFChooseFromListActionPrompt='Which payment is this memo for?',
                   WFChooseFromListActionSelectMultiple=False, WFChooseFromListActionSelectAll=False)
    s.settext('pickedText', picked)
    s.each(rows)
    s.setvar('row', V('Repeat Item'))
    s.settext('rowSummary', s.get_value(V('row'), 'summary'))
    s.if_(V('rowSummary'), 4, text=(V('pickedText'),))
    s.settext('chosenId', s.get_value(V('row'), 'submissionId'))
    s.end()
    s.end()

    s.settext('memoText', s.ask('Memo for ', V('pickedText')))
    s.if_(s.count(V('memoText'), chars=True), 4, number=0)
    s.output('skipped')
    s.end()

    now = s.act('date', 'CurrentDate', WFDateActionMode='Current Date')
    stamp = s.fmt_date(now, "yyyyMMdd'T'HHmmss")
    rand = s.act('number.random', s.name('Random'), WFRandomNumberMinimum=10000, WFRandomNumberMaximum=99999)
    body = s.dictionary([('submissionId', (V('chosenId'),)), ('memo', (V('memoText'),)), ('capturedAt', (s.fmt_date(now, ISO),))])
    # Into the same outbox as the SMS: if this send fails, Fintrack Memos sends it later.
    saved = s.save_file(s.text(body), 'Fintrack/outbox/', stamp, '-memo-', rand, '.json')
    s.setvar('memoFile', saved)
    status = s.text(s.get_value(s.read_json(s.request(API, '/api/v1/memos', 'POST', body_file=V('memoFile'), key_var='token')), 'status'))
    s.if_(status, 4, text='accepted')
    s.delete(V('memoFile'))
    s.notify('Memo saved: ', V('memoText'))
    s.output('saved')
    s.end()
    s.notify('Memo kept on this iPhone; it will be sent with the next bank message.')
    s.output('queued')
    return s.finish()


# ── Checks, packaging, signing ─────────────────────────────────────────────

def validate(name: str, actions: list, api: str) -> None:
    text = json.dumps(actions, ensure_ascii=False)
    assert THIRD_PARTY_NAME not in text.lower(), f'{name}: third-party name found'
    stack, defined, variables = [], set(), {'Repeat Item', 'ShortcutInput'}
    api_uuid = next(a['WFWorkflowActionParameters']['UUID'] for a in actions
                    if a['WFWorkflowActionParameters'].get('CustomOutputName') == 'API_BASE')
    for i, action in enumerate(actions):
        p = action.get('WFWorkflowActionParameters', {})
        body = json.dumps(p, ensure_ascii=False)
        for ref in re.findall(r'"OutputUUID": "([0-9A-Fa-f-]+)"', body):
            assert ref in defined, f'{name}: action {i} uses an output before it exists'
        for var in re.findall(r'"VariableName": "([^"]+)"', body):
            assert var in variables, f'{name}: action {i} reads ${var} before it is set'
        if action['WFWorkflowActionIdentifier'].endswith(('setvariable', 'appendvariable')):
            variables.add(p['WFVariableName'])
        if p.get('UUID'):
            defined.add(p['UUID'])
        mode = p.get('WFControlFlowMode')
        if mode == 0:
            stack.append(p['GroupingIdentifier'])
        elif mode == 2:
            assert stack and stack.pop() == p['GroupingIdentifier'], f'{name}: unbalanced block at {i}'
        if action['WFWorkflowActionIdentifier'].endswith('downloadurl'):
            url = p['WFURL']['Value']
            first = url['attachmentsByRange'].get('{0, 1}', {})
            assert url['string'].startswith(OBJ) and first.get('OutputUUID') == api_uuid, f'{name}: request {i} is not to API_BASE'
    assert not stack, f'{name}: unclosed blocks'
    assert api.startswith('https://'), 'the API must be https'


def package(name: str, actions: list, takes_input: bool) -> dict:
    workflow = {
        'WFWorkflowActions': actions,
        'WFWorkflowClientVersion': '4610',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59446},
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': INPUT_CLASSES if takes_input else [],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': [],
        'WFQuickActionSurfaces': [],
        'WFWorkflowHasShortcutInputVariables': takes_input,
        'WFWorkflowHasOutputFallback': False,
    }
    if takes_input:
        # Run by hand, it asks for text: a pairing line, a command or a pasted SMS.
        workflow['WFWorkflowNoInputBehavior'] = {'Name': 'WFWorkflowNoInputBehaviorAskForInput',
                                                 'Parameters': {'ItemClass': 'WFStringContentItem'}}
    return workflow


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--api', required=True, help='https base URL of the Fintrack API')
    parser.add_argument('--out', required=True, help='folder for the signed .shortcut files')
    parser.add_argument('--no-sign', action='store_true')
    args = parser.parse_args()
    api = args.api.rstrip('/')
    out = Path(os.path.expanduser(args.out))
    out.mkdir(parents=True, exist_ok=True)
    for name, build, takes_input in (('Fintrack Memos', build_memos, True), ('Add Fintrack memo', build_add_memo, False)):
        actions = build(api)
        validate(name, actions, api)
        unsigned = out / f'.{name}.unsigned.shortcut'
        with open(unsigned, 'wb') as f:
            plistlib.dump(package(name, actions, takes_input), f, fmt=plistlib.FMT_BINARY)
        target = out / f'{name}.shortcut'
        if args.no_sign:
            unsigned.rename(target)
        else:
            subprocess.run(['shortcuts', 'sign', '--mode', 'anyone', '--input', str(unsigned), '--output', str(target)], check=True)
            unsigned.unlink()
        print(f'{name}: {len(actions)} actions → {target}')


if __name__ == '__main__':
    sys.exit(main())
