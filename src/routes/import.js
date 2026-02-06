const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { parseHdfcStatement } = require('../parse/hdfc');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function getDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

router.post('/hdfc', upload.single('statement'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Missing file: statement' });
  }

  const client = await pool.connect();
  try {
    const entries = parseHdfcStatement(req.file.buffer);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'No entries parsed from statement.' });
    }

    const lastDateResult = await client.query(
      'SELECT MAX(transaction_date) AS last_date FROM transactions'
    );
    const lastDate = getDateOnly(lastDateResult.rows[0]?.last_date || null);

    const filtered = lastDate
      ? entries.filter((e) => e.transactionDate > lastDate)
      : entries;

    filtered.sort((a, b) => a.transactionDate - b.transactionDate);

    const periodStart = entries[0].transactionDateIso;
    const periodEnd = entries[entries.length - 1].transactionDateIso;

    await client.query('BEGIN');

    let insertedRows = 0;
    if (filtered.length > 0) {
      const values = [];
      const placeholders = [];
      filtered.forEach((e, idx) => {
        const base = idx * 8;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
        );
        values.push(
          e.transactionDateIso,
          e.narration,
          e.withdrawal,
          e.deposit,
          e.balance,
          e.upiName,
          e.upiDescription,
          e.upiBank
        );
      });

      const insertQuery = `
        INSERT INTO transactions (
          transaction_date,
          narration,
          withdrawal,
          deposit,
          balance,
          upi_name,
          upi_description,
          upi_bank
        ) VALUES ${placeholders.join(', ')}
      `;
      await client.query(insertQuery, values);
      insertedRows = filtered.length;
    }

    await client.query(
      `INSERT INTO statement_imports (
        filename,
        period_start,
        period_end,
        last_tx_date_before,
        total_rows,
        inserted_rows
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.file.originalname,
        periodStart,
        periodEnd,
        lastDate ? lastDate.toISOString().slice(0, 10) : null,
        entries.length,
        insertedRows,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Import complete',
      totalParsed: entries.length,
      insertedRows,
      lastDateBefore: lastDate ? lastDate.toISOString().slice(0, 10) : null,
      periodStart,
      periodEnd,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/last', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, source_bank, filename, period_start, period_end, last_tx_date_before,
              total_rows, inserted_rows, uploaded_at
         FROM statement_imports
        ORDER BY uploaded_at DESC
        LIMIT 1`
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No imports found.' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const offset = (page - 1) * limit;

    const result = await client.query(
      `SELECT id, source_bank, filename, period_start, period_end, last_tx_date_before,
              total_rows, inserted_rows, uploaded_at
         FROM statement_imports
        ORDER BY uploaded_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.json({
      page,
      limit,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid import id.' });
    }

    const result = await client.query(
      `SELECT id, source_bank, filename, period_start, period_end, last_tx_date_before,
              total_rows, inserted_rows, uploaded_at
         FROM statement_imports
        WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Import not found.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/transactions/range', async (req, res) => {
  const client = await pool.connect();
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end are required (YYYY-MM-DD).' });
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const result = await client.query(
      `SELECT id, transaction_date, narration, withdrawal, deposit, balance,
              upi_name, upi_description, upi_bank, created_at
         FROM transactions
        WHERE transaction_date BETWEEN $1 AND $2
        ORDER BY transaction_date ASC, id ASC`,
      [start, end]
    );

    return res.json({
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
