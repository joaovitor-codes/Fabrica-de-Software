<<<<<<< HEAD
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
=======
import { IsEmail, IsNotEmpty, IsString } from "class-validator";
>>>>>>> feat/refresh-token

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