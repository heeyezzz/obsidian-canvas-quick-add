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
  getData(): { nodes: CanvasNodeRef[] };
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

export default class CanvasQuickAddPlugin extends Plugin {
  settings: QuickAddSettings = { ...DEFAULT_SETTINGS };

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
   * 键盘弹起后白板容器被压缩，按钮会落到右侧控件栏那一列的下端。
   * 两类 chrome 形状不同，绕法也不同：
   * .canvas-menu（选中卡片的工具条）又宽又矮，从上方绕；
   * .canvas-controls（缩放/撤销那排，Advanced Canvas 还会往里加项）又窄又高，从左侧绕。
   */
  private reposition(view: CanvasViewLike) {
    const anchor = this.anchor(view);
    const el = anchor?.querySelector(`.${BUTTON_CLASS}`) as HTMLElement | null;
    if (!anchor || !el) return;

    el.style.removeProperty('bottom');
    el.style.removeProperty('right');

    const er = el.getBoundingClientRect();
    const lift = this.overlapAmount(view, '.canvas-menu', er, 'v');
    const slide = this.overlapAmount(view, '.canvas-controls', er, 'h');
    if (!lift && !slide) return;

    const cs = getComputedStyle(el);
    if (lift) el.style.bottom = `${parseFloat(cs.bottom) + lift}px`;
    if (slide) el.style.right = `${parseFloat(cs.right) + slide}px`;
  }

  /** 返回把按钮从该 chrome 上躲开所需的位移量（像素），不重叠则 0 */
  private overlapAmount(
    view: CanvasViewLike,
    selector: string,
    er: DOMRect,
    axis: 'v' | 'h'
  ): number {
    const node = view.containerEl.querySelector(selector) as HTMLElement | null;
    if (!node) return 0;

    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return 0;
    if (er.right <= r.left || er.left >= r.right || er.bottom <= r.top || er.top >= r.bottom) {
      return 0;
    }

    return axis === 'v' ? er.bottom - r.top + 8 : er.right - r.left + 8;
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
    if (!canvas || typeof canvas.createTextNode !== 'function' || typeof canvas.posCenter !== 'function') {
      new Notice('拿不到 Canvas 内部接口，Obsidian 升级后需要重新适配。');
      return;
    }
    const node = canvas.createTextNode({ pos: this.nextFreePos(canvas), position: 'center' });

    // 卡片可能落在视口下方，用 Obsidian 自己的平移逻辑滚进来
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
   * 从视口中心往下找第一个空位，一列排满就往左右换列。
   * 位置只限制在可视范围内，因为 startEditing 不会把屏幕外的卡片滚进来。
   */
  private nextFreePos(canvas: CanvasInternal): CanvasPos {
    const center = canvas.posCenter();
    if (!canvas.config?.defaultTextNodeDimensions || typeof canvas.getData !== 'function') {
      return center;
    }

    const { width, height } = canvas.config.defaultTextNodeDimensions;
    const taken = canvas.getData().nodes.map((n) => ({
      x: n.x + n.width / 2,
      y: n.y + n.height / 2,
      w: n.width,
      h: n.height,
    }));

    for (let i = 0; i < 60; i++) {
      const p = { x: center.x, y: center.y + i * (height + GAP) };
      const blocked = taken.some(
        (t) =>
          Math.abs(t.x - p.x) < (t.w + width) / 2 + GAP &&
          Math.abs(t.y - p.y) < (t.h + height) / 2 + GAP
      );
      if (!blocked) return p;
    }

    return center;
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
