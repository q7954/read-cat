import { defineStore, storeToRefs } from 'pinia';
import { useTextContentStore } from './text-content';
import { useMessage } from '../hooks/message';
import { isNull } from '../core/is';
import { PluginType } from '../core/plugins';
import { useScrollTopStore } from './scrolltop';
import { useTextContent } from '../views/read/hooks/text-content';
import { useSettingsStore } from './settings';


export const useReadAloudStore = defineStore('ReadAloud', {
  state: () => {
    return {
      isPlay: false,
      readAloudRef: null as HTMLAudioElement | null,
      audios: [] as { blob: Blob, index: number }[],
      currentPlayIndex: -1,
      abortController: null as AbortController | null,
      chapterUrl: null as string | null,
    }
  },
  getters: {

  },
  actions: {
    addReadAloudClass() {
      const { scrollTop } = useScrollTopStore();
      const p = document.querySelector<HTMLElement>(`#text-content p[data-index="${this.currentPlayIndex}"]`);
      if (!isNull(p)) {
        p.previousElementSibling?.classList.remove('current-read-aloud');
        p.classList.add('current-read-aloud');
        scrollTop(p.offsetTop - window.screen.height / 3);
      }
    },
    async play(start = 0) {
      const {
        isRunningGetTextContent,
        textContent,
        currentChapter
      } = storeToRefs(useTextContentStore());
      const message = useMessage();
      if (isRunningGetTextContent.value) {
        message.warning('正在获取正文');
        return;
      }
      if (isNull(textContent.value) || textContent.value.length <= 0) {
        message.error('无法获取正文');
        return;
      }
      if (isNull(currentChapter.value)) {
        message.error('无法获取章节信息');
        return;
      }
      if (isNull(this.readAloudRef)) {
        message.error('无法获取AudioRef');
        return;
      }
      const plugins = GLOBAL_PLUGINS.getPluginsByType(PluginType.TTS_ENGINE, {
        enable: true
      });
      if (plugins.length <= 0) {
        message.error('未能获取到TTS插件, 插件不存在或未启用');
        return;
      }
      
      if (this.chapterUrl === currentChapter.value.url) {
        this.readAloudRef.play();
        this.addReadAloudClass();
        return;
      }
      if (this.abortController) {
        this.abortController.abort();
      }
      this.chapterUrl = currentChapter.value.url;
      this.currentPlayIndex = -1;
      this.audios = [];
      this.abortController = null;
      const { instance } = plugins[0];
      this.abortController = new AbortController();
      let first = true;
      const play = () => {
        if (isNull(this.readAloudRef)) {
          return;
        }
        const audio = this.audios[this.currentPlayIndex <= -1 ? 0 : this.currentPlayIndex];
        if (audio) {
          const old = this.readAloudRef.src;
          this.readAloudRef.src = '';
          URL.revokeObjectURL(old);
          this.readAloudRef.src = URL.createObjectURL(audio.blob);
          this.readAloudRef.play();
          this.isPlay = true;
          this.currentPlayIndex = audio.index;

          // 为正在朗读的段落添加class
          this.addReadAloudClass();
        }
      }
      this.readAloudRef.onended = () => {
        this.isPlay = false;
        this.currentPlayIndex += 1;
        if (!isNull(textContent.value) && this.currentPlayIndex >= textContent.value.length) {
          const { nextChapter } = useTextContent();
          const { options } = useSettingsStore();
          this.currentPlayIndex = -1;
          first = true;
          this.audios = [];
          if (options.enableAutoReadAloudNextChapter) {
            message.info('朗读结束, 准备朗读下一章节');
            setTimeout(() => {
              nextChapter().then(() => {
                this.play(0);
              });
            }, 1000);
          } else {
            message.info('朗读结束');
            this.abortController?.abort();
            this.abortController = null;
            this.chapterUrl = null;
            this.currentPlayIndex = -1;
            this.audios = [];
          }
        } else {
          play();
        }
      }
      this.readAloudRef.onpause = () => {
        this.isPlay = false;
      }
      this.readAloudRef.onplay = () => {
        this.isPlay = true;
      }
      
      await instance.transform(textContent.value, {
        start,
        signal: this.abortController.signal,
        rate: 0.1,
        volume: 0.5,
        voice: 'Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)'
      }, (blob, index) => {
        if (first) {
          this.audios = [];
          this.audios[index] = { blob, index };
          this.currentPlayIndex = index;
          play();
          first = false;
        } else {
          this.audios[index] = { blob, index };
        }
      }, () => {
        GLOBAL_LOG.debug('transform end');
      });
    },
    pause() {
      this.readAloudRef?.pause();
    }
  }
});