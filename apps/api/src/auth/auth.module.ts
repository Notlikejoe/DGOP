import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { AccessModule } from '../access/access.module';

@Module({
  imports: [
    UsersModule,
    AccessModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const environment = config.get<string>('NODE_ENV') ?? 'development';
        const strictConfig = !['development', 'test'].includes(environment);
        const secret = config.get<string>('JWT_SECRET');
        if (strictConfig && (!secret || secret.length < 32)) {
          throw new Error('JWT_SECRET must be set to at least 32 characters outside development');
        }
        return {
          secret: secret ?? 'dev-insecure-secret',
          signOptions: {
            expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '8h') as unknown as number,
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
