import { IsEmail, IsNotEmpty, IsString } from "class-validator";

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