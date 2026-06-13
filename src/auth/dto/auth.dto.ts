import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

// We wrap the WebAuthn response JSON in a `credential` object property rather
// than spreading its fields onto the DTO: the global ValidationPipe runs with
// forbidNonWhitelisted, which would strip/reject the many nested fields of a
// RegistrationResponseJSON. Whitelisting only inspects top-level DTO props, so
// the nested payload passes through untouched and @simplewebauthn validates it.
export class VerifyRegistrationDto {
  @IsObject()
  credential!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class VerifyAuthenticationDto {
  @IsObject()
  credential!: Record<string, unknown>;
}
