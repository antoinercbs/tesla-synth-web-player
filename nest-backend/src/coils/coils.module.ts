import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeslaCoil } from './entities/tesla-coil.entity';
import { CoilsController } from './coils.controller';
import { CoilsService } from './coils.service';

@Module({
  imports: [TypeOrmModule.forFeature([TeslaCoil])],
  controllers: [CoilsController],
  providers: [CoilsService],
})
export class CoilsModule {}
