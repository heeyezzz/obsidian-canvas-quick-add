import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
} from 'obsidian';

type CanvasPos = { x: number; y: number };
type CanvasSize = { width: number; height: number };
type CanvasBox = { minX: number; minY: number; maxX: number; maxY: number };
type CanvasNodeRef = { x: number; y: number; width: number; height: number };

/**
 * Obsidian 没有公开 Canvas 运行时 API，下面的成员是从 1.14.4 渲染包里读出来的。
 * 只调用、不替换，所以 Advanced Canvas 这类插件打在上面的补丁照常生效。
 */
type CanvasInternal = {
  posCenter(): CanvasPos;
  /** 范围比视口小就纯平移，只有比视口大才退化成 zoomToBbox */
  panIntoView(bbox: CanvasBox, padding?: number): void;
  config: { defaultTextNodeDimensions: CanvasSize };
  createTextNode(options: {
    pos: CanvasPos;
    position?: 'center' | 'top-left';
    size?: CanvasSize;
    text?: string;
    save?: boolean;
    focus?: boolean;
  }): CanvasNodeRef;
};

type CanvasViewLike = {
  containerEl: HTMLElement;
  canvas?: CanvasInternal;
};

type QuickAddSettings = { showOnDesktop: boolean };

const DEFAULT_SETTINGS: QuickAddSettings = { showOnDesktop: false };
const BUTTON_CLASS = 'cqa-add-card';
// 新卡片之间的间距，和 Obsidian 批量建文件卡用的偏移量一致
const GAP = 45;
// 卡片排成几列
const COLUMNS = 2;

export default class CanvasQuickAddPlugin extends Plugin {
  settings: QuickAddSettings = { ...DEFAULT_SETTINGS };

  /** 每个白板视图各自的网格锚点 */
  private origins = new WeakMap<CanvasViewLike, CanvasPos>();

  /** 每个视图里已经建了几张卡，决定下一张落在网格哪一格 */
  private counters = new WeakMap<CanvasViewLike, number>();

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'add-text-card',
      name: '在白板视口中心新建文本卡片',
      callback: () => this.addCard(this.activeCanvasView()),
    });

    const refresh = () => this.refresh();
    this.app.workspace.onLayoutReady(refresh);
    this.registerEvent(this.app.workspace.on('layout-change', refresh));
    this.registerEvent(this.app.workspace.on('active-leaf-change', refresh));
    this.registerEvent(this.app.workspace.on('file-open', refresh));
    // 键盘弹出和收起会改 window 尺寸，按钮该不该抬升取决于那一刻工具条在哪
    this.registerDomEvent(window, 'resize', refresh);

    this.addSettingTab(new QuickAddSettingTab(this.app, this));
  }

  onunload() {
    for (const view of this.canvasViews()) this.removeButton(view);
  }

  private canvasViews(): CanvasViewLike[] {
    return this.app.workspace
      .getLeavesOfType('canvas')
      .filter(
        (leaf) => (leaf as unknown as { isDeferred?: boolean }).isDeferred !== true
      )
      .map((leaf) => leaf.view as unknown as CanvasViewLike);
  }

  private activeCanvasView(): CanvasViewLike | null {
    const active = this.app.workspace.getActiveViewOfType(ItemView);
    if (active?.getViewType() === 'canvas') return active as unknown as CanvasViewLike;
    return this.canvasViews()[0] ?? null;
  }

  private shouldShow(): boolean {
    // Obsidian 用 body.is-phone 隐藏底部的卡片菜单，这里跟它对齐：菜单没了才补按钮，
    // 平板上官方菜单还在，就不重复出现。
    return document.body.classList.contains('is-phone') || this.settings.showOnDesktop;
  }

  /** Canvas 的外壳是异步渲染的，layout-ready 那一刻 .canvas-wrapper 往往还不存在 */
  refresh() {
    this.syncAll();
    for (const delay of [150, 500, 1500]) {
      const id = window.setTimeout(() => this.syncAll(), delay);
      this.register(() => window.clearTimeout(id));
    }
  }

  syncAll() {
    const show = this.shouldShow();
    for (const view of this.canvasViews()) {
      if (show) {
        this.addButton(view);
        this.reposition(view);
      } else {
        this.removeButton(view);
      }
    }
  }

  /**
   * 按钮默认贴在容器左上角。唯一可能压到它的是选中卡片浮出的 .canvas-menu，
   * 那张工具条在卡片上方，卡片贴顶时工具条就会顶到左上角，这时把按钮挪到它下面。
   */
  private reposition(view: CanvasViewLike) {
    const anchor = this.anchor(view);
    const el = anchor?.querySelector(`.${BUTTON_CLASS}`) as HTMLElement | null;
    if (!anchor || !el) return;

    el.style.removeProperty('top');
    const menu = view.containerEl.querySelector('.canvas-menu') as HTMLElement | null;
    if (!menu) return;

    const mr = menu.getBoundingClientRect();
    if (mr.width === 0 || mr.height === 0) return;

    const er = el.getBoundingClientRect();
    if (er.right <= mr.left || er.left >= mr.right || er.bottom <= mr.top || er.top >= mr.bottom) {
      return;
    }

    el.style.top = `${mr.bottom - anchor.getBoundingClientRect().top + 8}px`;
  }

  /** 挂到 Obsidian 那组缩放控件的父节点上，和官方 chrome 共用同一个定位上下文 */
  private anchor(view: CanvasViewLike): HTMLElement | null {
    const controls = view.containerEl.querySelector('.canvas-controls');
    return (controls?.parentElement ??
      view.containerEl.querySelector('.canvas-wrapper')) as HTMLElement | null;
  }

  private addButton(view: CanvasViewLike) {
    const anchor = this.anchor(view);
    if (!anchor || anchor.querySelector(`.${BUTTON_CLASS}`)) return;

    const group = anchor.createDiv({
      cls: `canvas-control-group mod-raised ${BUTTON_CLASS}`,
    });
    const item = group.createDiv({
      cls: 'canvas-control-item',
      attr: { role: 'button', tabindex: '0', 'aria-label': '新建卡片' },
    });
    setIcon(item, 'plus');
    item.appendText('卡片');

    this.registerDomEvent(item, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.addCard(view);
    });
  }

  private removeButton(view: CanvasViewLike) {
    view.containerEl.querySelector(`.${BUTTON_CLASS}`)?.remove();
  }

  private addCard(view: CanvasViewLike | null) {
    const canvas = view?.canvas;
    if (!view || !canvas || typeof canvas.createTextNode !== 'function' || typeof canvas.posCenter !== 'function') {
      new Notice('拿不到 Canvas 内部接口，Obsidian 升级后需要重新适配。');
      return;
    }
    const node = canvas.createTextNode({ pos: this.nextFreePos(view, canvas), position: 'center' });

    // 卡片可能落在视口外，用 Obsidian 自己的平移逻辑滚进来
    if (node && typeof canvas.panIntoView === 'function') {
      canvas.panIntoView({
        minX: node.x,
        maxX: node.x + node.width,
        minY: node.y,
        maxY: node.y + node.height,
      });
    }

    // 新卡片会带出浮动工具条，位置是异步算的，重排几次才稳
    this.refresh();
  }

  /**
   * 双列网格。第 1 张落在锚点，第 2 张在它右侧，第 3 张在它正下方，
   * 第 4 张在第 2 张下方，以此类推。
   * 位置只由"这是本视图第几张"决定，不做找空位的搜索，网格才是确定的。
   * 不限制在视口内，可见性交给 panIntoView。
   */
  private nextFreePos(view: CanvasViewLike, canvas: CanvasInternal): CanvasPos {
    const center = canvas.posCenter();
    const dims = canvas.config?.defaultTextNodeDimensions;
    if (!dims) return center;

    // 锚点取这个视图第一次点按钮时的视口中心，之后网格固定从它长开
    const origin = this.origins.get(view) ?? center;
    this.origins.set(view, origin);

    const nth = this.counters.get(view) ?? 0;
    this.counters.set(view, nth + 1);

    return {
      x: origin.x + (nth % COLUMNS) * (dims.width + GAP),
      y: origin.y + Math.floor(nth / COLUMNS) * (dims.height + GAP),
    };
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class QuickAddSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CanvasQuickAddPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('桌面端也显示按钮')
      .setDesc(
        '默认只在手机上显示，因为 Obsidian 在手机上会隐藏底部的卡片菜单（平板不受影响）。打开它可以在电脑上预览按钮效果。'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showOnDesktop)
          .onChange(async (value) => {
            this.plugin.settings.showOnDesktop = value;
            await this.plugin.saveSettings();
            this.plugin.refresh();
          })
      );
  }
}
