import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CurrentUser, Public } from './decorators';
import { AuthUser } from './auth.types';
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  clearAuthCookieOptions,
  readCookie,
} from './auth-cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip ?? req.socket?.remoteAddress;
    const result = await this.auth.login(dto.email, dto.password, ip);
    res.cookie(AUTH_COOKIE_NAME, result.accessToken, authCookieOptions(req));
    return result;
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Public()
  @Get('session')
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readCookie(req, AUTH_COOKIE_NAME);
    const user = await this.auth.sessionFromToken(token);
    if (token && !user) {
      res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions(req));
    }
    return user;
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE_NAME, clearAuthCookieOptions(req));
    return this.auth.logout(user);
  }
}
