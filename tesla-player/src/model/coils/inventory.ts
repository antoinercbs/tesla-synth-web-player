import type { StoredSpec } from '@/model/coils/spec';

/** A real coil of the inventory, as the API returns it. */
export interface TeslaCoil {
  id: number;
  uuid: string;
  name: string;
  /** Its place in the inventory; until songs pick their coils, the coil at position k plays output k. */
  position: number;
  spec: StoredSpec;
  /** Coils sharing a group are twins: built alike, one plays for another. */
  twinGroup: string | null;
  notes: string | null;
  updatedAt: number | null;
  editorName: string | null;
}

/** What the sheet sends (the server fills id/uuid/updatedAt/editorName). */
export interface TeslaCoilInput {
  name: string;
  position?: number;
  spec: StoredSpec;
  twinGroup?: string | null;
  notes?: string | null;
}
