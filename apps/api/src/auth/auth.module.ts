import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { AccessModule } from '../access/access.module';
import { isProductionLikeRuntime, isUnsafeJwtSecret } from '../common/runtime-safety';
import { jwtDurationSeconds } from './auth-duration';

@Module({
  imports: [
    UsersModule,
    AccessModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const strictConfig = isProductionLikeRuntime();
        const secret = config.get<string>('JWT_SECRET');
        if (strictConfig && isUnsafeJwtSecret(secret)) {
          throw new Error('JWT_SECRET must be at least 32 characters and not use a known placeholder outside development');
        }
        return {
          secret: secret ?? 'dev-insecure-secret',
          signOptions: {
            expiresIn: jwtDurationSeconds(config.get<string>('JWT_EXPIRES_IN')),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
