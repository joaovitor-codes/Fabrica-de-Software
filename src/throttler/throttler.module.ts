import { Global, Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";

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
  providers: [],
})
export class ThrottlerModul {}