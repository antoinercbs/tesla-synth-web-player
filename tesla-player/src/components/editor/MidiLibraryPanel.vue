<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import axios from "axios";
import { useMidiStore } from "@/stores/midi";
import { formatDuration } from "@/utils/format";
import { search } from "@/utils/search";
import { envelope } from "@/sysex/envelopes";
import type { MidiFile, Song } from "@/types/domain";
import { RouterLink } from "vue-router";
import EmptyState from "@/components/ui/EmptyState.vue";
import SearchField from "@/components/ui/SearchField.vue";
import DataTable from "@/components/ui/DataTable.vue";
import DropMenu from "@/components/ui/DropMenu.vue";
import UsageMenu from "@/components/ui/UsageMenu.vue";
import LibraryConfirm from "@/components/ui/LibraryConfirm.vue";
import SelectionBar from "@/components/ui/SelectionBar.vue";
import type { DataColumn, Usage } from "@/components/ui/data-table";
import { uploadMidiFile } from "@/midi/upload";
import { useFileDrop } from "@/utils/file-drop";

/**
 * The MIDI file manager interface: import (button or drop anywhere on it), searchable table,
 * download, delete, and a link to the file's editor. Owns all its own UI state; talks to
 * the host only through `select` (a file to use). Its library pieces are shared with the
 * songs' and the playlists' (SongLibrary, PlaylistLibrary).
 *
 * Presentational + self-contained, so it can be hosted either inside a modal
 * (the editor's MidiLibraryModal) or directly on a page (MidiFilesView) without
 * duplicating any of this logic. Transient state (search, drag, pending delete,
 * upload message) is reset by remounting — the modal renders it with `v-if`, and
 * the page mounts it once.
 */
const props = withDefaults(defineProps<{ currentId?: number | null; selectable?: boolean }>(), {
    currentId: null,
    selectable: true,
});
const emit = defineEmits<{
    (e: "select", id: number | null): void;
}>();

const { t } = useI18n();
const midiStore = useMidiStore();

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const librarySearch = ref("");
// one file (its menu) or the ticked ones
const pendingDelete = ref<MidiFile[]>([]);
const selectedIds = ref<(number | string)[]>([]);
const selectedFiles = computed(() => midiStore.midiFileList.filter((f) => selectedIds.value.includes(f.id)));
const deleteMessage = computed(() =>
    pendingDelete.value.length > 1 ? t("label.deleteFiles", { n: pendingDelete.value.length }) : undefined,
);
const uploadMsg = ref<{ type: "success" | "error"; name?: string } | null>(
    null,
);
const replaceInput = ref<HTMLInputElement | null>(null);
const targetReplaceId = ref<number | null>(null);
const editingId = ref<number | null>(null);
const editName = ref("");
// one name is edited at a time: a single input
const editInput = ref<HTMLInputElement | null>(null);

// newest first, so a freshly-uploaded file appears at the top of the list; a song's name finds its file
const filteredLibrary = computed(() => {
    const list = [...midiStore.midiFileList].sort((a, b) => b.id - a.id);
    return search(list, librarySearch.value, (f) => [f.name, ...(songsByMidi.value.get(f.id) ?? []).map((s) => s.name)]);
});

function pickFile(): void {
    fileInput.value?.click();
}
function onFileChosen(e: Event): void {
    const files = (e.target as HTMLInputElement).files;
    if (files) uploadMultiple(files)
}
const { active: dragActive, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop((files) => uploadMultiple(files));
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
        const data = await uploadMidiFile(file);
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
        editInput.value?.focus();
        editInput.value?.select();
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
    pendingDelete.value = [f];
}
function cancelDelete(): void {
    pendingDelete.value = [];
}
async function confirmDelete(): Promise<void> {
    const targets = pendingDelete.value;
    pendingDelete.value = [];
    for (const target of targets) {
        try {
            await axios.delete(`/api/midi/${target.id}`);
            midiStore.deleteMidiFile(target.id);
            if (props.currentId === target.id) emit("select", null);
        } catch (err) {
            console.error("MIDI delete failed", err);
            break;
        }
    }
    selectedIds.value = [];
}
async function downloadSelected(): Promise<void> {
    // one after the other: a browser asks before a page saves many files at once
    for (const f of selectedFiles.value) await downloadFile(f);
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
function usesOf(f: MidiFile): Usage[] {
    return (songsByMidi.value.get(f.id) ?? []).map((s) => ({ key: s.id, label: s.name, to: `/edit/${s.id}`, coils: s.coilCount }));
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

function programsOf(f: MidiFile): number[] {
    return [...new Set(Object.values(f.programs ?? {}))];
}
// the instruments the files start on, to filter on
const programOptions = computed(() =>
    [...new Set(midiStore.midiFileList.flatMap(programsOf))]
        .sort((a, b) => a - b)
        .map((p) => ({ value: p, label: `P${p} · ${envelope(p).name}` })),
);

const columns = computed<DataColumn<MidiFile>[]>(() => [
    { key: "name", label: t("label.fileName"), width: "minmax(0, 1fr)", sort: (f) => f.name },
    { key: "duration", label: t("label.duration"), width: "5rem", narrowWidth: "4.2rem", num: true, sort: (f) => f.durationMs },
    { key: "channels", label: t("label.channels"), width: "5rem", num: true, hide: "narrow", sort: (f) => f.channels },
    {
        key: "programs", label: t("label.instruments"), width: "minmax(0, 10rem)", hide: "narrow",
        filter: { options: programOptions.value, values: programsOf },
    },
    {
        key: "uses", label: t("label.usedBy"), width: "8rem", narrowWidth: "6.6rem", sort: (f) => usesOf(f).length,
        filter: {
            options: [{ value: "used", label: t("label.inUse") }, { value: "unused", label: t("label.notInUse") }],
            values: (f) => (usesOf(f).length ? "used" : "unused"),
        },
    },
]);
</script>

<template>
    <div class="lib midi-lib" style="height: 100%" @dragenter="onDragEnter" @dragover="onDragOver"
        @dragleave="onDragLeave" @drop="onDrop">
        <input ref="fileInput" type="file" accept=".mid,.midi" style="display: none" @change="onFileChosen" />
        <input ref="replaceInput" type="file" accept=".mid,.midi" style="display: none" @change="onReplaceFileChosen" />

        <div class="lib__bar">
            <search-field v-model="librarySearch" :placeholder="$t('label.searchFile')" />
            <button class="btn btn--volt" type="button" :disabled="uploading" @click="pickFile">
                <span class="icon"><i class="fas" :class="uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'"></i></span>
                <span>{{ $t("label.import") }}</span>
            </button>
        </div>
        <p class="lib__hint">{{ $t("label.dropMidiAnywhere") }}</p>

        <div v-if="uploadMsg && !pendingDelete.length" class="lib__msg" :class="`is-${uploadMsg.type}`">
            <i class="fas" :class="uploadMsg.type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'"></i>
            <span v-if="uploadMsg.type === 'success'">{{ uploadMsg.name }} · {{ $t("label.uploaded") }}</span>
            <span v-else>{{ $t("label.uploadFailed") }}</span>
        </div>

        <library-confirm v-if="pendingDelete.length" :name="pendingDelete[0].name" :message="deleteMessage"
            @confirm="confirmDelete" @cancel="cancelDelete" />

        <data-table v-model:selected="selectedIds" :columns="columns" :rows="filteredLibrary" :row-key="(f) => f.id"
            :current="currentId" storage-key="midi" :selectable="selectable">
            <template #cell-name="{ row: f }">
                <span v-if="editingId === f.id" class="midi-lib__name-edit">
                    <input type="text" v-model="editName" ref="editInput"
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
                <span v-else class="data-table__name" @dblclick="startEditName(f)">{{ f.name }}</span>
            </template>
            <template #cell-duration="{ row: f }">{{ formatDuration(f.durationMs) }}</template>
            <template #cell-channels="{ row: f }">{{ f.channels ?? "–" }}</template>
            <template #cell-programs="{ row: f }">
                <span class="data-table__text mono" :title="programsTitle(f)">{{ programsLabel(f) }}</span>
            </template>
            <!-- who depends on the file, before anyone deletes it -->
            <template #cell-uses="{ row: f }">
                <usage-menu :items="usesOf(f)" :count="$t('label.songsCount', usesOf(f).length)" :header="$t('label.usedFor')" />
            </template>
            <template #actions="{ row: f }">
                <RouterLink class="data-table__btn midi-lib__edit-link" :to="{ name: 'midi-edit', params: { id: f.id } }"
                    :title="$t('midiEditor.open')" :aria-label="$t('midiEditor.open')">
                    <i class="fas fa-pen-to-square"></i>
                </RouterLink>
                <drop-menu>
                    <RouterLink class="dropdown__item" :to="{ name: 'edit', params: { id: 'new' }, query: { file: String(f.id) } }">
                        <i class="fas fa-file-circle-plus"></i>
                        <span>{{ $t("label.songFromFile") }}</span>
                    </RouterLink>
                    <div class="dropdown__divider"></div>
                    <button class="dropdown__item" type="button" @click="startEditName(f)">
                        <i class="fa-solid fa-pen"></i>
                        <span>{{ $t("label.rename") }}</span>
                    </button>
                    <button class="dropdown__item" type="button" @click="triggerReplace(f)">
                        <i class="fa-solid fa-cloud-arrow-up"></i>
                        <span>{{ $t("label.replaceFile") }}</span>
                    </button>
                    <button class="dropdown__item" type="button" @click="downloadFile(f)">
                        <i class="fas fa-download"></i>
                        <span>{{ $t("label.download") }}</span>
                    </button>
                    <div class="dropdown__divider"></div>
                    <button class="dropdown__item is-danger" type="button" @click="requestDelete(f)">
                        <i class="fas fa-trash"></i>
                        <span>{{ $t("label.delete") }}</span>
                    </button>
                </drop-menu>
            </template>
            <template #empty>
                <template v-if="midiStore.midiFileList.length === 0">
                    <empty-state variant="stub" icon="fa-folder-open">{{ $t("label.noMidiFilesYet") }}</empty-state>
                    <button class="btn btn--volt" type="button" @click="pickFile">
                        <span class="icon"><i class="fas fa-cloud-arrow-up"></i></span>
                        <span>{{ $t("label.import") }}</span>
                    </button>
                </template>
                <template v-else>{{ $t("label.noResults") }}</template>
            </template>
        </data-table>

        <selection-bar v-if="selectedFiles.length" :count="selectedFiles.length"
            :label="$t('label.selectedFiles', selectedFiles.length)" @clear="selectedIds = []">
            <button class="btn" type="button" @click="downloadSelected">
                <span class="icon"><i class="fas fa-download"></i></span>{{ $t("label.download") }}
            </button>
            <button class="btn btn--danger-ghost" type="button" @click="pendingDelete = selectedFiles">
                <span class="icon"><i class="fas fa-trash"></i></span>{{ $t("label.delete") }}
            </button>
        </selection-bar>

        <!-- only while files are dragged over; pointer-events: none keeps the drag depth count on the rows below -->
        <div v-if="dragActive" class="lib__drop">
            <span class="lib__drop-icon"><i class="fas fa-cloud-arrow-up"></i></span>
            <span>{{ $t("label.dropToImport") }}</span>
        </div>
    </div>
</template>
