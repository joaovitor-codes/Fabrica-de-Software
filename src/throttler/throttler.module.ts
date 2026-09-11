import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

@Global()
@Module({
  imports: [
     ThrottlerModule.forRoot({
          throttlers: [{
            name: 'default',
            ttl: 60_000,
            limit: 10,
          }]
        }),
  ],
  controllers: [],
  providers: [{
    provide: APP_GUARD,
    useClass: ThrottlerGuard,
  }],
})
export class ThrottlerModul {}