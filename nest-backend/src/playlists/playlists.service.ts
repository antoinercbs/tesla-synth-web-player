import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { Song } from '../songs/entities/song.entity';
import { hashPlaylist } from '../sync/content-hash';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist } from './entities/playlist.entity';

/** JSON shape returned to the front, identical to the original Flask output. */
export interface PlaylistResponse {
  id: number;
  name: string;
  coilCount: number;
  songIds: number[];
  /** Who last edited this (server-stamped from the OIDC token), or null. */
  editorName: string | null;
}

@Injectable()
export class PlaylistsService {
  constructor(
    @InjectRepository(Playlist)
    private readonly playlistRepository: Repository<Playlist>,
    @InjectRepository(Song)
    private readonly songRepository: Repository<Song>,
  ) {}

  async findAll(): Promise<PlaylistResponse[]> {
    const playlists = await this.playlistRepository.find();
    return playlists.map((playlist) => this.toResponse(playlist));
  }

  async create(
    dto: CreatePlaylistDto,
    editorName: string | null = null,
  ): Promise<PlaylistResponse> {
    const playlist = this.fromDto(new Playlist(), dto);
    playlist.uuid = randomUUID();
    await this.stampSync(playlist, editorName);
    const saved = await this.playlistRepository.save(playlist);
    return this.toResponse(saved);
  }

  async update(
    id: number,
    dto: CreatePlaylistDto,
    editorName: string | null = null,
  ): Promise<PlaylistResponse> {
    const playlist = await this.playlistRepository.findOne({ where: { id } });
    if (!playlist) {
      throw new NotFoundException(`Playlist ${id} not found`);
    }
    // Replace the song list wholesale (delete-then-insert, like Flask), with a
    // targeted statement so it does not depend on ON DELETE CASCADE.
    await this.playlistRepository.query(
      'DELETE FROM PlaylistSong WHERE playlist_id = ?',
      [id],
    );
    this.fromDto(playlist, dto);
    // uuid is preserved (loaded with the row); only the change signal is bumped.
    await this.stampSync(playlist, editorName);
    const saved = await this.playlistRepository.save(playlist);
    return this.toResponse(saved);
  }

  async remove(id: number): Promise<void> {
    const playlist = await this.playlistRepository.findOne({ where: { id } });
    if (!playlist) {
      throw new NotFoundException(`Playlist ${id} not found`);
    }
    await this.playlistRepository.query(
      'DELETE FROM PlaylistSong WHERE playlist_id = ?',
      [id],
    );
    await this.playlistRepository.delete(id);
  }

  private fromDto(playlist: Playlist, dto: CreatePlaylistDto): Playlist {
    playlist.name = dto.name;
    playlist.coilCount = dto.coilCount ?? 3;
    playlist.playlistSongs = dto.songIds.map((songId, idx) => {
      const playlistSong = new PlaylistSong();
      playlistSong.songId = songId;
      playlistSong.idx = idx;
      return playlistSong;
    });
    return playlist;
  }

  /** Stamps the sync change-signal (updatedAt + contentHash) plus the
   *  server-authoritative editorName. The hash references member songs by their
   *  stable uuid, so it matches across instances. */
  private async stampSync(
    playlist: Playlist,
    editorName: string | null,
  ): Promise<void> {
    playlist.updatedAt = Date.now();
    playlist.editorName = editorName;
    const songUuids = await this.resolveSongUuids(playlist.playlistSongs ?? []);
    playlist.contentHash = hashPlaylist({
      name: playlist.name,
      coilCount: playlist.coilCount ?? 3,
      songUuids,
      editorName: playlist.editorName,
    });
  }

  /** Maps the playlist's ordered song ids to their uuids, dropping any that no
   *  longer resolve (kept consistent with SyncService.applyPlaylist). */
  private async resolveSongUuids(
    playlistSongs: PlaylistSong[],
  ): Promise<string[]> {
    const ordered = [...playlistSongs].sort((a, b) => a.idx - b.idx);
    const ids = ordered.map((ps) => ps.songId);
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.songRepository.find({
      where: { id: In(ids) },
      select: { id: true, uuid: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r.uuid]));
    return ids
      .map((id) => byId.get(id))
      .filter((u): u is string => typeof u === 'string');
  }

  private toResponse(playlist: Playlist): PlaylistResponse {
    const songIds = [...(playlist.playlistSongs ?? [])]
      .sort((a, b) => a.idx - b.idx)
      .map((playlistSong) => playlistSong.songId);
    return {
      id: playlist.id,
      name: playlist.name,
      coilCount: playlist.coilCount ?? 3,
      songIds,
      editorName: playlist.editorName ?? null,
    };
  }
}
