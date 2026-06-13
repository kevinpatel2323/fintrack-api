import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebauthnCredential } from '../database/entities/webauthn-credential.entity';
import { AuthSession } from '../database/entities/auth-session.entity';
import { WebauthnChallenge } from '../database/entities/webauthn-challenge.entity';
import { AuthController } from './auth.controller';
import { WebauthnService } from './webauthn.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WebauthnCredential,
      AuthSession,
      WebauthnChallenge,
    ]),
  ],
  controllers: [AuthController],
  providers: [WebauthnService, SessionService],
  // SessionService is exported so the global SessionGuard (registered in
  // AppModule as an APP_GUARD) can resolve it.
  exports: [SessionService, WebauthnService],
})
export class AuthModule {}
