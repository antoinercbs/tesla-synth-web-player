<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import axios from "axios";
import { useMidiStore } from "@/stores/midi";
import { formatDuration } from "@/utils/format";
import { envelope } from "@/sysex/envelopes";
import type { MidiFile, Song } from "@/types/domain";
import { RouterLink } from "vue-router";
import EmptyState from "@/components/ui/EmptyState.vue";

/**
 * The MIDI file manager interface: import (button or drop anywhere on it), searchable table,
 * download, delete, and a link to the file's editor. Owns all its own UI state; talks to
 * the host only through `select` (a file to use).
 *
 * Presentational + self-contained, so it can be hosted either inside a modal
 * (the editor's MidiLibraryModal) or directly on a page (MidiFilesView) without
 * duplicating any of this logic. Transient state (search, drag, pending delete,
 * upload message) is reset by remounting — the modal renders it with `v-if`, and
 * the page mounts it once.
 */
const props = withDefaults(defineProps<{ currentId?: number | null }>(), {
    currentId: null,
});
const emit = defineEmits<{
    (e: "select", id: number | null): void;
}>();

const midiStore = useMidiStore();

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const dragActive = ref(false);
const librarySearch = ref("");
const pendingDelete = ref<{ id: number; name: string } | null>(null);
const uploadMsg = ref<{ type: "success" | "error"; name?: string } | null>(
    null,
);
const replaceInput = ref<HTMLInputElement | null>(null);
const targetReplaceId = ref<number | null>(null);
const editingId = ref<number | null>(null);
const editName = ref("");
const editInputs = ref<HTMLInputElement[]>([]);

const filteredLibrary = computed(() => {
    const q = librarySearch.value.trim().toLowerCase();
    // Newest first, so a freshly-uploaded file appears at the top of the list.
    const list = [...midiStore.midiFileList].sort((a, b) => b.id - a.id);
    return q ? list.filter((f) => f.name.toLowerCase().includes(q)) : list;
});

function pickFile(): void {
    fileInput.value?.click();
}
function onFileChosen(e: Event): void {
    const files = (e.target as HTMLInputElement).files;
    if (files) uploadMultiple(files)
}
// dragenter/dragleave also fire for every child crossed: count them so the overlay doesn't flicker
let dragDepth = 0;
function isFileDrag(e: DragEvent): boolean {
    return !!e.dataTransfer?.types.includes("Files");
}
function onDragEnter(e: DragEvent): void {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    dragActive.value = true;
}
function onDragOver(e: DragEvent): void {
    if (isFileDrag(e)) e.preventDefault();
}
function onDragLeave(e: DragEvent): void {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragActive.value = false;
}
function onDrop(e: DragEvent): void {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dragActive.value = false;
    const files = e.dataTransfer?.files;
    if (files) uploadMultiple(files)
}
function triggerReplace(f: MidiFile): void {
    targetReplaceId.value = f.id;
    replaceInput.value?.click();
}

async function uploadMultiple(files: FileList): Promise<void> {
    for (var i = 0, len = files.length; i < len; i++) {
        uploadOne(files[i])
    };
}

async function uploadOne(file: File): Promise<void> {
    uploading.value = true;
    uploadMsg.value = null;
    try {
        const form = new FormData();
        form.append("file", file);
        // No manual Content-Type: the browser sets multipart/form-data + boundary.
        const { data } = await axios.post<MidiFile>("/api/midi", form);
        midiStore.addMidiFileToList(data);
        emit("select", data.id); // auto-select the freshly uploaded file
        uploadMsg.value = { type: "success", name: data.name };
    } catch (err) {
        console.error("MIDI upload failed", err);
        uploadMsg.value = { type: "error", name: file.name };
    } finally {
        uploading.value = false;
        if (fileInput.value) fileInput.value.value = "";
    }
}
async function downloadFile(f: MidiFile): Promise<void> {
    // Fetch as a blob so the saved file uses the given MIDI name (the `download`
    // attribute is ignored on cross-origin <a> links, which would otherwise keep
    // the raw prefixed filename from the URL).
    try {
        const { data } = await axios.get(f.path.replace(/^\./, ""), {
            responseType: "blob",
        });
        const url = URL.createObjectURL(data as Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("MIDI download failed", err);
    }
}
async function onReplaceFileChosen(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0];
    const targetId = targetReplaceId.value;

    if (f && targetId !== null) {
        uploading.value = true;
        uploadMsg.value = null;
        try {
            const form = new FormData();
            form.append("file", f);

            const { data } = await axios.put<MidiFile>(
                `/api/midi/${targetId}/file`,
                form,
            );

            midiStore.updateMidiFile(data);
            emit("select", data.id);
            uploadMsg.value = { type: "success", name: data.name };
        } catch (err) {
            console.error("MIDI replace failed", err);
            uploadMsg.value = { type: "error", name: f.name };
        } finally {
            uploading.value = false;
            if (replaceInput.value) replaceInput.value.value = "";
            targetReplaceId.value = null;
        }
    }
}
function startEditName(f: MidiFile): void {
    editingId.value = f.id;
    editName.value = f.name;

    nextTick(() => {
        const input = editInputs.value.find(
            (el) => el && el.dataset.id === String(f.id),
        );
        if (input) {
            input.focus();
            input.select();
        }
    });
}

function cancelEditName(): void {
    editingId.value = null;
    editName.value = "";
}

async function saveEditName(f: MidiFile): Promise<void> {
    const newName = editName.value.trim();

    if (!newName || newName === f.name) {
        cancelEditName();
        return;
    }

    try {
        const { data } = await axios.patch<MidiFile>(`/api/midi/${f.id}/name`, {
            name: newName,
        });

        midiStore.updateMidiFile(data);
    } catch (err) {
        console.error("MIDI rename failed", err);
    } finally {
        cancelEditName();
    }
}

function requestDelete(f: MidiFile): void {
    pendingDelete.value = { id: f.id, name: f.name };
}
function cancelDelete(): void {
    pendingDelete.value = null;
}
async function confirmDelete(): Promise<void> {
    const target = pendingDelete.value;
    if (!target) return;
    pendingDelete.value = null;
    try {
        await axios.delete(`/api/midi/${target.id}`);
        midiStore.deleteMidiFile(target.id);
        if (props.currentId === target.id) emit("select", null);
    } catch (err) {
        console.error("MIDI delete failed", err);
    }
}

const songsByMidi = computed(() => {
    const map = new Map<number, Song[]>();
    for (const song of midiStore.midiSongList) {
        const id = song.midiFile?.id;
        if (id == null) continue;
        const list = map.get(id);
        if (list) list.push(song);
        else map.set(id, [song]);
    }
    return map;
});
function usesOf(f: MidiFile): Song[] {
    return songsByMidi.value.get(f.id) ?? [];
}

/** Distinct starting instruments, e.g. "P0 · P33 · P48"; the tooltip names them per channel. */
function programsLabel(f: MidiFile): string {
    const ps = [...new Set(Object.values(f.programs ?? {}))].sort((a, b) => a - b);
    return ps.length ? ps.map((p) => `P${p}`).join(" · ") : "—";
}
function programsTitle(f: MidiFile): string | undefined {
    const rows = Object.entries(f.programs ?? {}).map(([ch, p]) => `ch ${ch} · P${p} ${envelope(p).name}`);
    return rows.length ? rows.join("\n") : undefined;
}

/** Flips the menu upwards when it would overflow the bottom of the list. */
function alignDropdown(e: MouseEvent): void {
    const wrapper = e.currentTarget as HTMLElement;
    const menu = wrapper.querySelector<HTMLElement>(".midi-lib__dropdown-menu");
    const list = wrapper.closest<HTMLElement>(".midi-lib__list");
    if (!menu || !list) return;

    // Measured while forced visible, then restored: the menu is display:none
    // until :hover, and a hidden element has no height to measure.
    const originalDisplay = menu.style.display;
    menu.style.display = "flex";
    const overflows =
        wrapper.getBoundingClientRect().bottom + menu.offsetHeight + 10 >
        list.getBoundingClientRect().bottom;
    menu.style.display = originalDisplay;

    menu.classList.toggle("is-dropup", overflows);
}
</script>

<template>
    <div class="midi-lib" style="height: 100%" @dragenter="onDragEnter" @dragover="onDragOver"
        @dragleave="onDragLeave" @drop="onDrop">
        <input ref="fileInput" type="file" accept=".mid,.midi" style="display: none" @change="onFileChosen" />
        <input ref="replaceInput" type="file" accept=".mid,.midi" style="display: none" @change="onReplaceFileChosen" />

        <div class="midi-lib__bar">
            <div class="midi-lib__search">
                <span class="midi-lib__search-icon"><i class="fas fa-search"></i></span>
                <input class="text-field" type="text" v-model="librarySearch" :placeholder="$t('label.searchFile')" />
            </div>
            <button class="btn btn--volt" type="button" :disabled="uploading" @click="pickFile">
                <span class="icon"><i class="fas" :class="uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'"></i></span>
                <span>{{ $t("label.import") }}</span>
            </button>
        </div>
        <p class="midi-lib__hint">{{ $t("label.dropMidiAnywhere") }}</p>

        <div v-if="uploadMsg && !pendingDelete" class="midi-lib__msg" :class="uploadMsg.type">
            <i class="fas" :class="uploadMsg.type === 'success'
                ? 'fa-circle-check'
                : 'fa-circle-exclamation'
                "></i>
            <span v-if="uploadMsg.type === 'success'">{{ uploadMsg.name }} · {{ $t("label.uploaded") }}</span>
            <span v-else>{{ $t("label.uploadFailed") }}</span>
        </div>

        <div v-if="pendingDelete" class="midi-lib__msg confirm">
            <span class="midi-lib__confirm-text">
                <i class="fas fa-triangle-exclamation"></i>
                {{ $t("label.deleteQuestion") }} « {{ pendingDelete.name }} » ?
            </span>
            <span class="midi-lib__confirm-actions">
                <button class="btn btn--danger" type="button" @click="confirmDelete">
                    {{ $t("label.confirm") }}
                </button>
                <button class="btn btn--ghost" type="button" @click="cancelDelete">
                    {{ $t("label.cancel") }}
                </button>
            </span>
        </div>

        <div class="midi-lib__table">
            <div class="midi-lib__list">
                <div v-if="filteredLibrary.length" class="midi-lib__head">
                    <span>{{ $t("label.fileName") }}</span>
                    <span class="is-num">{{ $t("label.duration") }}</span>
                    <span class="is-num midi-lib__col-ch">{{ $t("label.channels") }}</span>
                    <span class="midi-lib__col-prog">{{ $t("label.instruments") }}</span>
                    <span>{{ $t("label.usedBy") }}</span>
                    <span></span>
                </div>
                <div v-for="f in filteredLibrary" :key="f.id" class="midi-lib__item"
                    :class="{ 'is-current': f.id === currentId }">
                    <span v-if="editingId === f.id" class="midi-lib__item-name-edit">
                        <input type="text" v-model="editName" :data-id="f.id" ref="editInputs"
                            @keyup.enter="saveEditName(f)" @keyup.esc="cancelEditName" @blur="saveEditName(f)" />
                        <button type="button" class="midi-lib__edit-icon" :title="$t('label.confirm')"
                            @mousedown.prevent="saveEditName(f)">
                            <i class="fas fa-check"></i>
                        </button>
                        <button type="button" class="midi-lib__edit-icon is-cancel" :title="$t('label.cancel')"
                            @mousedown.prevent="cancelEditName">
                            <i class="fas fa-xmark"></i>
                        </button>
                    </span>
                    <span v-else class="midi-lib__item-name" @dblclick="startEditName(f)">
                        {{ f.name }}
                    </span>
                    <span class="midi-lib__item-dur">{{ formatDuration(f.durationMs) }}</span>
                    <span class="midi-lib__item-ch midi-lib__col-ch">{{ f.channels ?? "–" }}</span>
                    <span class="midi-lib__item-prog midi-lib__col-prog" :title="programsTitle(f)">
                        {{ programsLabel(f) }}
                    </span>
                    <!-- who depends on the file, before anyone deletes it -->
                    <div class="midi-lib__usages midi-lib__dropdown" @mouseenter="alignDropdown">
                        <span class="midi-lib__usages-text" :class="{ 'is-none': !usesOf(f).length }">
                            {{ usesOf(f).length ? $t("label.songsCount", usesOf(f).length) : "—" }}
                        </span>
                        <div v-if="usesOf(f).length" class="midi-lib__dropdown-menu is-usages">
                            <div class="midi-lib__dropdown-header">
                                {{ $t("label.usedFor") }}
                            </div>
                            <RouterLink v-for="s in usesOf(f)" :key="s.id" class="midi-lib__dropdown-item"
                                :to="`/edit/${s.id}`">
                                <span class="midi-lib__usage-title">{{ s.name }}</span>
                                <span class="midi-lib__usage-coils">
                                    &middot; {{ s.coilCount }} <i class="fas fa-bolt"></i>
                                </span>
                            </RouterLink>
                        </div>
                    </div>
                    <div class="midi-lib__item-actions">
                        <RouterLink class="midi-lib__dl" :to="{ name: 'midi-edit', params: { id: f.id } }"
                            :title="$t('midiEditor.open')" :aria-label="$t('midiEditor.open')">
                            <i class="fas fa-pen-to-square"></i>
                        </RouterLink>
                        <div class="midi-lib__dropdown" @mouseenter="alignDropdown">
                            <button class="midi-lib__action" type="button" :aria-label="$t('label.moreOptions')">
                                <i class="fas fa-ellipsis-vertical"></i>
                            </button>
                            <div class="midi-lib__dropdown-menu">
                                <button class="midi-lib__dropdown-item" type="button" @click="startEditName(f)">
                                    <i class="fa-solid fa-pen"></i>
                                    <span>{{ $t("label.rename") }}</span>
                                </button>
                                <button class="midi-lib__dropdown-item" type="button" @click="triggerReplace(f)">
                                    <i class="fa-solid fa-cloud-arrow-up"></i>
                                    <span>{{ $t("label.replaceFile") }}</span>
                                </button>
                                <button class="midi-lib__dropdown-item" type="button" @click="downloadFile(f)">
                                    <i class="fas fa-download"></i>
                                    <span>{{ $t("label.download") }}</span>
                                </button>

                                <div class="midi-lib__dropdown-divider"></div>

                                <button class="midi-lib__dropdown-item is-danger" type="button"
                                    @click="requestDelete(f)">
                                    <i class="fas fa-trash"></i>
                                    <span>{{ $t("label.delete") }}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div v-if="midiStore.midiFileList.length === 0" class="midi-lib__empty">
                    <empty-state variant="stub" icon="fa-folder-open">{{ $t("label.noMidiFilesYet") }}</empty-state>
                    <button class="btn btn--volt" type="button" @click="pickFile">
                        <span class="icon"><i class="fas fa-cloud-arrow-up"></i></span>
                        <span>{{ $t("label.import") }}</span>
                    </button>
                </div>
                <div v-else-if="filteredLibrary.length === 0" class="midi-lib__empty">
                    {{ $t("label.noResults") }}
                </div>
            </div>
        </div>

        <!-- only while files are dragged over; pointer-events: none keeps the drag depth count on the rows below -->
        <div v-if="dragActive" class="midi-lib__drop">
            <span class="midi-lib__drop-icon"><i class="fas fa-cloud-arrow-up"></i></span>
            <span>{{ $t("label.dropToImport") }}</span>
        </div>
    </div>
</template>
