import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EditorName } from '../auth/editor-name.decorator';
import { Public } from '../auth/public.decorator';
import { PublishEventDto, SaveTuningDto } from './dto/tuning.dto';
import {
  TuningEvent,
  TuningSessionInfo,
  TuningSessionsService,
} from './tuning-sessions.service';
import { TuningResponse, TuningsService } from './tunings.service';

type Side = 'desktop' | 'camera';
function sideOf(v: string | undefined): Side | undefined {
  return v === 'desktop' || v === 'camera' ? v : undefined;
}
function afterOf(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Live relay between the player and the phone during a tuning session.
 *
 * Creating a session needs the normal API access (it is the signed-in player);
 * everything else is gated by the session TOKEN instead of OIDC, because the
 * phone joins through a QR code without any account. The token travels in the
 * `x-tuning-token` header, or in `?token=` for the SSE stream (EventSource
 * cannot set headers).
 */
@Controller('tuning/sessions')
export class TuningSessionsController {
  constructor(private readonly sessions: TuningSessionsService) {}

  @Post()
  create(): { id: string; token: string; createdAt: number; expiresAt: number } {
    return this.sessions.create();
  }

  @Public()
  @Get(':id')
  info(
    @Param('id') id: string,
    @Headers('x-tuning-token') header: string | undefined,
    @Query('token') query: string | undefined,
  ): TuningSessionInfo {
    return this.sessions.info(id, header || query);
  }

  /** Live feed. `after` = last sequence number already seen (replayed from the ring). */
  @Public()
  @Sse(':id/events')
  events(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Query('after') after: string | undefined,
    @Query('who') who: string | undefined,
  ): Observable<MessageEvent> {
    return this.sessions.stream(id, token, afterOf(after), sideOf(who)).pipe(
      map((ev: TuningEvent): MessageEvent => ({ id: String(ev.seq), data: ev })),
    );
  }

  /** Polling alternative to the stream (used where SSE cannot flow, e.g. Electron's in-process transport). */
  @Public()
  @Get(':id/poll')
  poll(
    @Param('id') id: string,
    @Headers('x-tuning-token') header: string | undefined,
    @Query('token') query: string | undefined,
    @Query('after') after: string | undefined,
    @Query('who') who: string | undefined,
  ): { events: TuningEvent[]; info: TuningSessionInfo } {
    return this.sessions.poll(id, header || query, afterOf(after), sideOf(who));
  }

  @Public()
  @Post(':id/events')
  publish(
    @Param('id') id: string,
    @Headers('x-tuning-token') header: string | undefined,
    @Query('token') query: string | undefined,
    @Body() dto: PublishEventDto,
  ): TuningEvent {
    return this.sessions.publish(id, header || query, dto.from, dto.type, dto.payload);
  }

  @Public()
  @Post(':id/heartbeat')
  heartbeat(
    @Param('id') id: string,
    @Headers('x-tuning-token') header: string | undefined,
    @Query('token') query: string | undefined,
    @Query('who') who: string | undefined,
  ): TuningSessionInfo {
    return this.sessions.heartbeat(id, header || query, sideOf(who) ?? 'desktop');
  }

  @Public()
  @Delete(':id')
  @HttpCode(200)
  close(
    @Param('id') id: string,
    @Headers('x-tuning-token') header: string | undefined,
    @Query('token') query: string | undefined,
  ): string {
    this.sessions.info(id, header || query); // authenticates
    this.sessions.close(id);
    return 'OK';
  }
}

/** Saved tunings (history per coil). Normal API access. */
@Controller('tunings')
export class TuningsController {
  constructor(private readonly tunings: TuningsService) {}

  @Get()
  findAll(@Query('coilIndex') coilIndex?: string): Promise<TuningResponse[]> {
    const n = coilIndex == null || coilIndex === '' ? undefined : Number(coilIndex);
    return this.tunings.findAll(Number.isFinite(n) ? n : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TuningResponse> {
    return this.tunings.findOne(id);
  }

  @Post()
  create(
    @Body() dto: SaveTuningDto,
    @EditorName() editorName: string | null,
  ): Promise<TuningResponse> {
    return this.tunings.create(dto, editorName);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTuningDto,
    @EditorName() editorName: string | null,
  ): Promise<TuningResponse> {
    return this.tunings.update(id, dto, editorName);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    await this.tunings.remove(id);
    return 'OK';
  }
}
