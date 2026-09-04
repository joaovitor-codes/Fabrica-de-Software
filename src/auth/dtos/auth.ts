import { IsEmail, IsNotEmpty } from "class-validator";

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