import {
  Star,
  Gift,
  Flame,
  FileText,
  ClipboardCheck,
  MessageCircle,
  FileQuestion,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Calendar,
  Camera,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Headphones,
  HelpCircle,
  Home,
  Image,
  Info,
  Loader2,
  LogOut,
  Maximize2,
  Menu,
  MessageCircleMore,
  EllipsisVertical,
  MessageSquare,
  Monitor,
  Smartphone,
  MessageSquarePlus,
  Mic,
  Minimize2,
  Minus,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Send,
  Settings,
  Share2,
  Sparkles,
  Square,
  LayoutGrid,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  Users,
  Video,
  Volume2,
  VolumeX,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import * as glyphs from './glyphs';

export interface RegistryEntry {
  component: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * The glyph draws itself in its own colours and must not take the `color` axis.
   * Only `credit-coin` is one: it is Figma's coin, a gold token SWEEP with the white mark
   * (UMK-1218), and its colours are deliberately not `currentColor`. Without this flag a `color`
   * prop would land a text class on an element that ignores it — legal, silent, and misleading.
   */
  fixedPalette?: true;
}

/**
 * One registry, two glyph sources (KTD4).
 *
 * A name maps either to a lucide component or to house artwork under `glyphs/`. Call sites
 * cannot tell which, which is the whole point: when Ensyra's own icon set is extracted, a
 * name moves from one column to the other and no call site changes.
 *
 * ACCEPTED, VISIBLE DIVERGENCE (KTD3): lucide backs only the names this repo never had house
 * artwork for. Every glyph that WAS drawn against Figma is moved in and served as itself —
 * substituting lucide for one of those was a real regression, because the drawings differ in
 * stroke weight, corner treatment and viewBox padding, and the chat surface renders them at
 * 20px where that reads. So the divergence is bounded to glyphs that had no house original;
 * closing it is an extraction ticket, not a swap.
 *
 * Names are kebab-case on BOTH sides on purpose. Keeping lucide's PascalCase for the lucide
 * half would let a reader tell the two sources apart at the call site, which is exactly the
 * distinction this registry exists to erase.
 */
export const ICON_REGISTRY = {
  // --- lucide-backed -------------------------------------------------------------------
  'alert-circle': { component: AlertCircle },
  'alert-triangle': { component: AlertTriangle },
  'arrow-left': { component: ArrowLeft },
  'arrow-right': { component: ArrowRight },
  'book-open': { component: BookOpen },
  calendar: { component: Calendar },
  camera: { component: Camera },
  check: { component: Check },
  'check-circle': { component: CheckCircle },
  'chevron-down': { component: ChevronDown },
  'chevron-left': { component: ChevronLeft },
  'chevron-right': { component: ChevronRight },
  'chevron-up': { component: ChevronUp },
  clock: { component: Clock },
  code: { component: Code },
  copy: { component: Copy },
  download: { component: Download },
  'external-link': { component: ExternalLink },
  eye: { component: Eye },
  'eye-off': { component: EyeOff },
  headphones: { component: Headphones },
  'help-circle': { component: HelpCircle },
  home: { component: Home },
  image: { component: Image },
  /** Distinct from `alert-circle`: an alert's four functions have to be told apart by SHAPE,
   *  not only by colour, so `info` cannot borrow the glyph `danger` uses. */
  info: { component: Info },
  loader: { component: Loader2 },
  logout: { component: LogOut },
  maximize: { component: Maximize2 },
  menu: { component: Menu },
  /** A chat bubble with an ellipsis (UMK-1333): `message-square` has no dots. */
  'ellipsis-bubble': { component: MessageCircleMore },
  /** Three dots in a column, the image card's "more" (UMK-1702): `ellipsis-bubble` is a chat bubble, not a menu glyph. */
  'ellipsis-vertical': { component: EllipsisVertical },
  'message-square': { component: MessageSquare },
  /** The device list's row glyph (UMK-925). */
  monitor: { component: Monitor },
  smartphone: { component: Smartphone },
  'message-square-plus': { component: MessageSquarePlus },
  mic: { component: Mic },
  minimize: { component: Minimize2 },
  minus: { component: Minus },
  paperclip: { component: Paperclip },
  pause: { component: Pause },
  play: { component: Play },
  plus: { component: Plus },
  refresh: { component: RefreshCw },
  'rotate-ccw': { component: RotateCcw },
  'rotate-cw': { component: RotateCw },
  star: { component: Star },
  gift: { component: Gift },
  fire: { component: Flame },
  'file-text': { component: FileText },
  'clipboard-check': { component: ClipboardCheck },
  'message-circle': { component: MessageCircle },
  'file-question': { component: FileQuestion },
  save: { component: Save },
  search: { component: Search },
  send: { component: Send },
  settings: { component: Settings },
  share: { component: Share2 },
  sparkles: { component: Sparkles },
  speaker: { component: Volume2 },
  'speaker-x': { component: VolumeX },
  square: { component: Square },
  /** The Feed 9 Kotak tool row on the tools home (UMK-1742). */
  grid: { component: LayoutGrid },
  'thumbs-down': { component: ThumbsDown },
  'thumbs-up': { component: ThumbsUp },
  trash: { component: Trash2 },
  user: { component: User },
  /** Two figures — `user` is a single one, a different drawing. */
  users: { component: Users },
  video: { component: Video },
  wrench: { component: Wrench },
  x: { component: X },
  'zoom-in': { component: ZoomIn },

  // --- house artwork -------------------------------------------------------------------
  'credit-coin': { component: glyphs.GlyphCreditCoin, fixedPalette: true },
  /**
   * Two DIFFERENT pens, which is why neither is `pencil`. `pen` is the 20-viewBox sidebar
   * glyph, `pen-edit` the 40-viewBox message action; collapsing them onto one lucide name
   * lost both drawings and made the two call sites render the same thing.
   */
  pen: { component: glyphs.GlyphPen },
  'pen-edit': { component: glyphs.GlyphPenEdit },
  'file-download': { component: glyphs.GlyphFileDownload },
  whatsapp: { component: glyphs.GlyphWhatsapp },
  ratio: { component: glyphs.GlyphRatio },
  'video-product': { component: glyphs.GlyphVideoProduct },
  'image-increase': { component: glyphs.GlyphImageIncrease },
  'help-centre': { component: glyphs.GlyphHelpCentre },
  guide: { component: glyphs.GlyphGuide },
  terms: { component: glyphs.GlyphTerms },
  privacy: { component: glyphs.GlyphPrivacy },
  /** The chip row's 20-viewBox up-right arrow (UMK-1333): six sites drew it inline. */
  'house-arrow': { component: glyphs.GlyphHouseArrow },

  /**
   * File-type badges. `file-generic` is the fallback `fileIconNameFor` returns for an
   * unknown mime, so it has to be house artwork even though a lucide `File` would look
   * passable — it renders beside its four siblings and has to match them.
   */
  'file-excel': { component: glyphs.GlyphFileExcel },
  'file-word': { component: glyphs.GlyphFileWord },
  'file-pdf': { component: glyphs.GlyphFilePdf },
  'file-csv': { component: glyphs.GlyphFileCsv },
  'file-generic': { component: glyphs.GlyphFileGeneric },

  /**
   * Figma's filled check — a disc with a knocked-out tick, drawn to sit INSIDE an already
   * filled mark (`01 Mark`'s `Done`). `check-circle` above stays lucide's OUTLINE and keeps
   * its callers; the two are different drawings for different jobs, so neither name may be
   * repointed at the other.
   */
  'check-circle-filled': { component: glyphs.GlyphCheckCircleFilled },
  /** The plan diamond (UMK-1210): an outline in `currentColor`, not the gold filled fallback. */
  diamond: { component: glyphs.GlyphDiamond },
  /**
   * The FILLED plan diamond (UMK-1218), "Paket Saat Ini" only: one `currentColor` drawing the
   * caller paints gray (free plan) or gold (paid). Not a replacement for the outline above.
   */
  'diamond-filled': { component: glyphs.GlyphDiamondFilled },
  /**
   * The plan-benefit check (UMK-1218): `check-circle-filled`'s drawing on the icon grid's padded 18
   * box, as Figma places it on the catalog cards. Not interchangeable with it (see the glyph).
   */
  'check-circle-bullet': { component: glyphs.GlyphCheckCircleBullet },
  /** Figma's `bag cart` (UMK-1218): the coin pill, "Tambah Paket" / "Tingkatkan Paket", "Beli Koin". */
  bag: { component: glyphs.GlyphBag },

  /**
   * The composer set (Figma "01 Chat Bar"). These are NOT lucide, deliberately: the drawings
   * differ in stroke weight, corner treatment and — for the paperclip — angle, and they render
   * at 20px inside a 32px button where that reads at a glance. They also sit on a 40 viewBox
   * drawn edge to edge, against lucide's padded 24, so substituting one changes the optical
   * size as well as the shape. Namespaced because the chat surface uses lucide's plus, image,
   * camera and check elsewhere and both drawings have to survive.
   */
  'composer-plus': { component: glyphs.GlyphComposerPlus },
  'composer-minus': { component: glyphs.GlyphComposerMinus },
  'composer-attach': { component: glyphs.GlyphComposerAttach },
  'composer-image': { component: glyphs.GlyphComposerImage },
  'composer-camera': { component: glyphs.GlyphComposerCamera },
  'composer-check-circle': { component: glyphs.GlyphComposerCheckCircle },
  'composer-mic': { component: glyphs.GlyphComposerMic },
  'composer-send': { component: glyphs.GlyphComposerSend },
  'composer-send-filled': { component: glyphs.GlyphComposerSendFilled },

  /**
   * The account-menu set. Filled 48-viewBox drawings, not lucide's stroked outlines — a
   * visibly different family, so the chevrons in particular cannot share a name with the
   * chat surface's lucide ones.
   */
  'menu-setting': { component: glyphs.GlyphMenuSetting },
  'menu-install': { component: glyphs.GlyphMenuInstall },
  'menu-help': { component: glyphs.GlyphMenuHelp },
  'menu-back': { component: glyphs.GlyphMenuBack },
  'menu-logout': { component: glyphs.GlyphMenuLogout },
  'menu-chevron-up': { component: glyphs.GlyphMenuChevronUp },
  'menu-chevron-down': { component: glyphs.GlyphMenuChevronDown },
  'menu-chevron-right': { component: glyphs.GlyphMenuChevronRight },
  /**
   * The Profil rows' Iconsax glyphs with no house drawing before (UMK-1885, Figma `Apps/Profile`):
   * 36-viewBox outlines drawn as `currentColor` fills, not the 48-viewBox drawings above.
   */
  'menu-book-saved': { component: glyphs.GlyphMenuBookSaved },
  'menu-tree': { component: glyphs.GlyphMenuTree },
  'menu-star': { component: glyphs.GlyphMenuStar },

  /** The Figma tiles on the landing surface and the template grid (20x20; the UMK-1887 four are Figma's 36x36 Iconsax exports). */
  'tile-layer': { component: glyphs.GlyphTileLayer },
  'tile-image': { component: glyphs.GlyphTileImage },
  'tile-image-sparkle': { component: glyphs.GlyphTileImageSparkle },
  'tile-video-play': { component: glyphs.GlyphTileVideoPlay },
  'tile-key': { component: glyphs.GlyphTileKey },
  'tile-path': { component: glyphs.GlyphTilePath },
  'tile-wallet': { component: glyphs.GlyphTileWallet },
  'tile-picture': { component: glyphs.GlyphTilePicture },
  'tile-shop': { component: glyphs.GlyphTileShop },
  'tile-video-camera': { component: glyphs.GlyphTileVideoCamera },
  'tile-box': { component: glyphs.GlyphTileBox },

  /**
   * The native-ui-v2 bottom navigation (identity doc §5.1, UMK-1604): an Iconsax outline glyph
   * per tab and its filled `-active` twin. Native-led; since UMK-1757 the web `TabBar` draws them
   * too. They are registered here because the two registries are one name list.
   */
  'nav-chat': { component: glyphs.GlyphNavChat },
  'nav-chat-active': { component: glyphs.GlyphNavChatActive },
  'nav-jalur': { component: glyphs.GlyphNavJalur },
  'nav-jalur-active': { component: glyphs.GlyphNavJalurActive },
  'nav-aktivitas': { component: glyphs.GlyphNavAktivitas },
  'nav-aktivitas-active': { component: glyphs.GlyphNavAktivitasActive },
  'nav-profil': { component: glyphs.GlyphNavProfil },
  'nav-profil-active': { component: glyphs.GlyphNavProfilActive },
  /** The tab header's bell (UMK-1605): Iconsax `notification`, outline. Native-led, like the nav set. */
  notification: { component: glyphs.GlyphNotification },
  /** A stroked winding path; the native journey thumbnail and the Riwayat Jalur empty state draw it. */
  'tab-journey': { component: glyphs.GlyphTabJourney },
  /** A stroked activity pulse; the web's Rapikan Catatan Keuangan done card draws "laba-rugi" with it. */
  'tab-activity': { component: glyphs.GlyphTabActivity },
  /** The Sosial Media page's brand cards (UMK-1601): Iconsax outline. Native-led, like the nav set. */
  instagram: { component: glyphs.GlyphInstagram },
  facebook: { component: glyphs.GlyphFacebook },
  /** The media viewer's bar (Diskusi, Ubah, Bagikan, Unduh, Post) and its time pill's play glyph (UMK-1703):
   *  Figma's own Iconsax drawings. Native-led, like the nav set. */
  'media-discuss': { component: glyphs.GlyphMediaDiscuss },
  'media-edit': { component: glyphs.GlyphMediaEdit },
  'media-share': { component: glyphs.GlyphMediaShare },
  'media-download': { component: glyphs.GlyphMediaDownload },
  'media-post': { component: glyphs.GlyphMediaPost },
  'media-play': { component: glyphs.GlyphMediaPlay },
  /** Simpan on the native Pengaturan Profil page (UMK-1886): Iconsax `screenmirroring`, Bold, as Figma draws it. */
  'screen-mirroring': { component: glyphs.GlyphScreenMirroring },
} as const satisfies Record<string, RegistryEntry>;

export type IconName = keyof typeof ICON_REGISTRY;

export const ICON_NAMES = Object.keys(ICON_REGISTRY) as IconName[];
