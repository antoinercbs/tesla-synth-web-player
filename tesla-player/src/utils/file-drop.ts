import { ref } from 'vue';

/**
 * Files dropped anywhere on an element: bind the four handlers on it, show a
 * veil while `active`. A drag of anything but files (text, a row) is left alone.
 */
export function useFileDrop(onFiles: (files: FileList) => void) {
  const active = ref(false);
  // dragenter/dragleave also fire for every child crossed: count them so the veil doesn't flicker
  let depth = 0;
  const isFileDrag = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files');

  function onDragEnter(e: DragEvent): void {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth++;
    active.value = true;
  }
  function onDragOver(e: DragEvent): void {
    if (isFileDrag(e)) e.preventDefault();
  }
  function onDragLeave(e: DragEvent): void {
    if (!isFileDrag(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) active.value = false;
  }
  function onDrop(e: DragEvent): void {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    depth = 0;
    active.value = false;
    const files = e.dataTransfer?.files;
    if (files?.length) onFiles(files);
  }
  return { active, onDragEnter, onDragOver, onDragLeave, onDrop };
}
