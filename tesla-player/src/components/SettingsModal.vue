<template>
    <div>
        <!-- Button to open the modal -->
        <button class="button is-small" @click="openModal">
            <i class="fas fa-cog"></i>
        </button>

        <!-- Modal -->
        <div class="modal" :class="{ 'is-active': showModal }">
            <div class="modal-background" @click="closeModal"></div>
            <div class="modal-content">
               
                <!-- Modal content -->
                <div class="panel">
                    <h2 class="panel-heading">{{$t('title.applicationSettings')}}</h2>
                    
                    <label class="panel-block setting">
                        <div class="line-head">
                            <span class="panel-icon">
                                <i class="fas fa-cog"></i>
                            </span>
                            {{$t('label.enableSecondMidiOutput')}}
                        </div>
                        <label class="checkbox">
                            <input type="checkbox" v-model="settings.enableSecondMidiOutput">
                        </label>
                    </label>

                    <label class="panel-block">
                        <button class="button is-fullwidth is-warning" @click="saveSettings">{{$t('label.save')}}</button>
                    </label>
                </div>


            </div>
            <button class="modal-close is-large" aria-label="close" @click="closeModal"></button>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            showModal: false,
            settings: {
                enableSecondMidiOutput: false
            }
        };
    },
    methods: {
        openModal() {
            this.showModal = true;
        },
        closeModal() {
            this.showModal = false;
        },
        saveSettings() {
            this.$store.commit('saveSettings', this.settings);
            this.showModal = false;
        }
    },
    created() {
        this.settings = this.$store.state.settings;
        console.log(this.settings);
    }
};
</script>

<style scoped lang="scss">
.setting {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .line-head {
        display: flex;
        align-items: center;
    }
}
</style>