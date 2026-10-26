import axios from 'axios';
import type { TeslaCoil, TeslaCoilInput } from '@/model/coils/inventory';

// the server's DTO takes no nulls: an absent field clears nothing, an empty string clears
const body = (c: TeslaCoilInput) => ({
  name: c.name, spec: c.spec, ...(c.position != null ? { position: c.position } : {}),
  twinGroup: c.twinGroup ?? '', notes: c.notes ?? '',
});

export const createCoil = (c: TeslaCoilInput) => axios.post<TeslaCoil>('/api/coils', body(c)).then((r) => r.data);
export const updateCoil = (id: number, c: TeslaCoilInput) => axios.put<TeslaCoil>(`/api/coils/${id}`, body(c)).then((r) => r.data);
export const reorderCoils = (ids: number[]) => axios.put<TeslaCoil[]>('/api/coils/order', { ids }).then((r) => r.data);
export const deleteCoil = (id: number) => axios.delete(`/api/coils/${id}`);
