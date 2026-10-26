import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** The app's content has scrolled under a page's sticky header: it takes a backdrop (`.screen-head.is-scrolled`). */
export function useScrolled(): Ref<boolean> {
  const scrolled = ref(false);
  let el: HTMLElement | null = null;
  const onScroll = () => { scrolled.value = (el?.scrollTop ?? 0) > 6; };
  onMounted(() => {
    el = document.querySelector('.app-main');
    el?.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });
  onBeforeUnmount(() => el?.removeEventListener('scroll', onScroll));
  return scrolled;
}
