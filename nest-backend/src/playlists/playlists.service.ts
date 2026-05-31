import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist } from './entities/playlist.entity';

/** JSON shape returned to the front, identical to the original Flask output. */
export interface PlaylistResponse {
  id: number;
  name: string;
  songIds: number[];
}

@Injectable()
export class PlaylistsService {
  constructor(
    @InjectRepository(Playlist)
    private readonly playlistRepository: Repository<Playlist>,
  ) {}

  async findAll(): Promise<PlaylistResponse[]> {
    const playlists = await this.playlistRepository.find();
    return playlists.map((playlist) => this.toResponse(playlist));
  }

  async create(dto: CreatePlaylistDto): Promise<PlaylistResponse> {
    const playlist = this.fromDto(new Playlist(), dto);
    const saved = await this.playlistRepository.save(playlist);
    return this.toResponse(saved);
  }

  async update(id: number, dto: CreatePlaylistDto): Promise<PlaylistResponse> {
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
    playlist.playlistSongs = dto.songIds.map((songId, idx) => {
      const playlistSong = new PlaylistSong();
      playlistSong.songId = songId;
      playlistSong.idx = idx;
      return playlistSong;
    });
    return playlist;
  }

  private toResponse(playlist: Playlist): PlaylistResponse {
    const songIds = [...(playlist.playlistSongs ?? [])]
      .sort((a, b) => a.idx - b.idx)
      .map((playlistSong) => playlistSong.songId);
    return { id: playlist.id, name: playlist.name, songIds };
  }
}
