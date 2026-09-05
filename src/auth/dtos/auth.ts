import { IsEmail, IsNotEmpty, IsString, Length } from "class-validator";

export class SignUpDto {
    @IsNotEmpty()
    name!: string;
    @IsEmail()
    email!: string;
    @IsNotEmpty()
    password!: string;
}

export class SignInDto {
    @IsEmail()
    email!: string;
    @IsNotEmpty()
    password!: string;
}

export class RefreshTokenDto {
    @IsString()
    @IsNotEmpty()
    refreshToken!: string;
}

export class ResetPasswordDto {
    @IsNotEmpty()
    currentPassword!: string;
    @IsNotEmpty()
    newPassword!: string;
}

export class RequestPasswordResetDto {
    @IsEmail()
    email!: string;
}

export class ConfirmPasswordResetDto {
    @IsNotEmpty()
    token!: string;
    @IsNotEmpty()
    newPassword!: string;
}

export class VerifyEmailDto {
    @IsEmail()
    email!: string;
    @IsString()
    @IsNotEmpty()
    @Length(6, 6)
    code!: string;
}

export class ResendEmailVerificationDto {
    @IsEmail()
    email!: string;
}