import type { ComponentType, ReactNode } from "react";
import {
  IconAlertWarningOutlineDuo18,
  IconArrowCornerBottomRightOutlineDuo18,
  IconArrowLeftOutlineDuo18,
  IconArrowRightOutlineDuo18,
  IconArrowRotateClockwiseOutlineDuo18,
  IconArrowUpOutlineDuo18,
  IconBellOutlineDuo18,
  IconBlueprintOutlineDuo18,
  IconBookOpenOutlineDuo18,
  IconBooksOutlineDuo18,
  IconBrainOutlineDuo18,
  IconBrushOutlineDuo18,
  IconCheckOutlineDuo18,
  IconChevronDownOutlineDuo18,
  IconChevronRightOutlineDuo18,
  IconCircleAsteriskOutlineDuo18,
  IconClockOutlineDuo18,
  IconCloudNodesOutlineDuo18,
  IconCloudOutlineDuo18,
  IconCompassOutlineDuo18,
  IconCopyOutlineDuo18,
  IconCreditCardOutlineDuo18,
  IconDatabaseOutlineDuo18,
  IconDotsOutlineDuo18,
  IconEnterDoorOutlineDuo18,
  IconEnvelopeOpenOutlineDuo18,
  IconEnvelopeOutlineDuo18,
  IconExitDoorOutlineDuo18,
  IconEyeDropperOutlineDuo18,
  IconGearOutlineDuo18,
  IconGlobeOutlineDuo18,
  IconGrid2x2OutlineDuo18,
  IconHeart2OutlineDuo18,
  IconHouseOutlineDuo18,
  IconHexagonsOutlineDuo18,
  IconImageOutlineDuo18,
  IconInputSearchOutlineDuo18,
  IconLayoutMainContentOutlineDuo18,
  IconLayoutSidebarOutlineDuo18,
  IconLightbulbOutlineDuo18,
  IconLinkOutlineDuo18,
  IconLoaderOutlineDuo18,
  IconLockOutlineDuo18,
  IconMediaPauseOutlineDuo18,
  IconMediaPlayOutlineDuo18,
  IconMediaSkipToEndOutlineDuo18,
  IconMenuOutlineDuo18,
  IconMonitorOutlineDuo18,
  IconMoonOutlineDuo18,
  IconMsgOutlineDuo18,
  IconNodes3OutlineDuo18,
  IconPenOutlineDuo18,
  IconPencilOutlineDuo18,
  IconPlugOutlineDuo18,
  IconPlusOutlineDuo18,
  IconRectLayoutGridOutlineDuo18,
  IconRocketOutlineDuo18,
  IconRotateObjAnticlockwiseOutlineDuo18,
  IconShieldCheckOutlineDuo18,
  IconShieldOutlineDuo18,
  IconShareUpRightOutlineDuo18,
  IconSidebarLeftHideOutlineDuo18,
  IconSidebarLeftShowOutlineDuo18,
  IconSquareDottedOutlineDuo18,
  IconStarOutlineDuo18,
  IconStorageOutlineDuo18,
  IconStackOutlineDuo18,
  IconSunHazeOutlineDuo18,
  IconTreeOutlineDuo18,
  IconTrashOutlineDuo18,
  IconUserOutlineDuo18,
  IconUsers2OutlineDuo18,
  IconXmarkOutlineDuo18,
  type IconProps,
} from "nucleo-ui-outline-duo-18";
import {
  IconProvider,
  type IconComponent,
  type IconComponentProps,
  type IconName,
} from "#/lib/icon-context";
import { cn } from "#/lib/utils";

/** Nucleo icon component accepted by both application callsites and Fluid slots. */
type AppIconComponent = IconComponent;

function withIconDefaults(Icon: ComponentType<IconProps>): AppIconComponent {
  function AppIcon({ className, size = 16, title, ...props }: IconComponentProps) {
    const isDecorative = title === undefined && props["aria-label"] === undefined;

    return (
      <Icon
        aria-hidden={isDecorative ? true : props["aria-hidden"]}
        className={cn("shrink-0", className)}
        focusable="false"
        size={size}
        title={title}
        {...props}
      />
    );
  }

  AppIcon.displayName = `Nucleo${Icon.displayName ?? Icon.name ?? "Icon"}`;
  return AppIcon;
}

function SlackMark({ className, size = 16, title, ...props }: IconComponentProps) {
  const isDecorative = title === undefined && props["aria-label"] === undefined;

  return (
    <svg
      aria-hidden={isDecorative ? true : props["aria-hidden"]}
      className={cn("shrink-0", className)}
      fill="none"
      focusable="false"
      height={size}
      role={isDecorative ? undefined : "img"}
      viewBox="0 0 18 18"
      width={size}
      {...props}
    >
      {title === undefined ? null : <title>{title}</title>}
      <path
        d="M6.25 2.25v3.5H4.5a1.75 1.75 0 1 1 1.75-1.75m5.5 0v1.75h1.75A1.75 1.75 0 1 0 11.75 4m4 2.25h-3.5V4.5A1.75 1.75 0 1 1 14 6.25m0 5.5h-1.75v1.75A1.75 1.75 0 1 0 14 11.75m-2.25 4v-3.5h1.75A1.75 1.75 0 1 1 11.75 14m-5.5 0v-1.75H4.5A1.75 1.75 0 1 0 6.25 14m-4-2.25h3.5v1.75A1.75 1.75 0 1 1 4 11.75m0-5.5h1.75V4.5A1.75 1.75 0 1 0 4 6.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

const Nucleo = {
  alertWarning: withIconDefaults(IconAlertWarningOutlineDuo18),
  arrowCornerBottomRight: withIconDefaults(IconArrowCornerBottomRightOutlineDuo18),
  arrowLeft: withIconDefaults(IconArrowLeftOutlineDuo18),
  arrowRight: withIconDefaults(IconArrowRightOutlineDuo18),
  arrowUp: withIconDefaults(IconArrowUpOutlineDuo18),
  bell: withIconDefaults(IconBellOutlineDuo18),
  blueprint: withIconDefaults(IconBlueprintOutlineDuo18),
  bookOpen: withIconDefaults(IconBookOpenOutlineDuo18),
  brain: withIconDefaults(IconBrainOutlineDuo18),
  brush: withIconDefaults(IconBrushOutlineDuo18),
  check: withIconDefaults(IconCheckOutlineDuo18),
  chevronDown: withIconDefaults(IconChevronDownOutlineDuo18),
  chevronRight: withIconDefaults(IconChevronRightOutlineDuo18),
  circle: withIconDefaults(IconCircleAsteriskOutlineDuo18),
  clock: withIconDefaults(IconClockOutlineDuo18),
  copy: withIconDefaults(IconCopyOutlineDuo18),
  compass: withIconDefaults(IconCompassOutlineDuo18),
  dots: withIconDefaults(IconDotsOutlineDuo18),
  envelope: withIconDefaults(IconEnvelopeOutlineDuo18),
  envelopeOpen: withIconDefaults(IconEnvelopeOpenOutlineDuo18),
  eyeDropper: withIconDefaults(IconEyeDropperOutlineDuo18),
  gear: withIconDefaults(IconGearOutlineDuo18),
  globe: withIconDefaults(IconGlobeOutlineDuo18),
  grid: withIconDefaults(IconGrid2x2OutlineDuo18),
  heart: withIconDefaults(IconHeart2OutlineDuo18),
  hexagons: withIconDefaults(IconHexagonsOutlineDuo18),
  house: withIconDefaults(IconHouseOutlineDuo18),
  image: withIconDefaults(IconImageOutlineDuo18),
  library: withIconDefaults(IconBooksOutlineDuo18),
  lightbulb: withIconDefaults(IconLightbulbOutlineDuo18),
  layoutSidebar: withIconDefaults(IconLayoutSidebarOutlineDuo18),
  link: withIconDefaults(IconLinkOutlineDuo18),
  loader: withIconDefaults(IconLoaderOutlineDuo18),
  lock: withIconDefaults(IconLockOutlineDuo18),
  menu: withIconDefaults(IconMenuOutlineDuo18),
  message: withIconDefaults(IconMsgOutlineDuo18),
  monitor: withIconDefaults(IconMonitorOutlineDuo18),
  moon: withIconDefaults(IconMoonOutlineDuo18),
  pause: withIconDefaults(IconMediaPauseOutlineDuo18),
  pen: withIconDefaults(IconPenOutlineDuo18),
  pencil: withIconDefaults(IconPencilOutlineDuo18),
  play: withIconDefaults(IconMediaPlayOutlineDuo18),
  plug: withIconDefaults(IconPlugOutlineDuo18),
  plus: withIconDefaults(IconPlusOutlineDuo18),
  rectangle: withIconDefaults(IconRectLayoutGridOutlineDuo18),
  rocket: withIconDefaults(IconRocketOutlineDuo18),
  rotate: withIconDefaults(IconRotateObjAnticlockwiseOutlineDuo18),
  search: withIconDefaults(IconInputSearchOutlineDuo18),
  share: withIconDefaults(IconShareUpRightOutlineDuo18),
  sidebarCollapse: withIconDefaults(IconSidebarLeftHideOutlineDuo18),
  sidebarExpand: withIconDefaults(IconSidebarLeftShowOutlineDuo18),
  shield: withIconDefaults(IconShieldOutlineDuo18),
  skipForward: withIconDefaults(IconMediaSkipToEndOutlineDuo18),
  square: withIconDefaults(IconSquareDottedOutlineDuo18),
  star: withIconDefaults(IconStarOutlineDuo18),
  stack: withIconDefaults(IconStackOutlineDuo18),
  sun: withIconDefaults(IconSunHazeOutlineDuo18),
  user: withIconDefaults(IconUserOutlineDuo18),
  users: withIconDefaults(IconUsers2OutlineDuo18),
  trash: withIconDefaults(IconTrashOutlineDuo18),
  x: withIconDefaults(IconXmarkOutlineDuo18),
} as const;

/** Complete Nucleo replacement map for every named Fluid Functionalism icon slot. */
const nucleoFluidIcons = {
  "arrow-left": Nucleo.arrowLeft,
  "arrow-right": Nucleo.arrowRight,
  "arrow-up": Nucleo.arrowUp,
  bell: Nucleo.bell,
  brain: Nucleo.brain,
  check: Nucleo.check,
  "chevron-down": Nucleo.chevronDown,
  "chevron-right": Nucleo.chevronRight,
  circle: Nucleo.circle,
  clock: Nucleo.clock,
  copy: Nucleo.copy,
  "corner-down-right": Nucleo.arrowCornerBottomRight,
  dot: Nucleo.dots,
  globe: Nucleo.globe,
  heart: Nucleo.heart,
  home: Nucleo.house,
  image: Nucleo.image,
  inbox: Nucleo.envelopeOpen,
  lightbulb: Nucleo.lightbulb,
  link: Nucleo.link,
  loader: Nucleo.loader,
  lock: Nucleo.lock,
  mail: Nucleo.envelope,
  menu: Nucleo.menu,
  "message-circle": Nucleo.message,
  monitor: Nucleo.monitor,
  moon: Nucleo.moon,
  paintbrush: Nucleo.brush,
  palette: Nucleo.brush,
  pause: Nucleo.pause,
  pencil: Nucleo.pen,
  pipette: Nucleo.eyeDropper,
  play: Nucleo.play,
  plus: Nucleo.plus,
  "rectangle-horizontal": Nucleo.rectangle,
  "rotate-ccw": Nucleo.rotate,
  rocket: Nucleo.rocket,
  search: Nucleo.search,
  settings: Nucleo.gear,
  shield: Nucleo.shield,
  "skip-forward": Nucleo.skipForward,
  "square-library": Nucleo.library,
  star: Nucleo.star,
  sun: Nucleo.sun,
  user: Nucleo.user,
  users: Nucleo.users,
  x: Nucleo.x,
} satisfies Record<IconName, IconComponent>;

/** Provides Nucleo implementations for all Fluid Functionalism icon slots. */
export function NucleoIconProvider({ children }: { readonly children: ReactNode }) {
  return <IconProvider icons={nucleoFluidIcons}>{children}</IconProvider>;
}

/** Product-level Nucleo icons used outside named Fluid component slots. */
export const Icons = {
  ArrowLeft: Nucleo.arrowLeft,
  ArrowRight: Nucleo.arrowRight,
  Bindings: withIconDefaults(IconTreeOutlineDuo18),
  Billing: withIconDefaults(IconCreditCardOutlineDuo18),
  Blueprint: Nucleo.blueprint,
  BookOpen: Nucleo.bookOpen,
  BoundResources: withIconDefaults(IconStorageOutlineDuo18),
  BrandMark: Nucleo.hexagons,
  Cloud: withIconDefaults(IconCloudOutlineDuo18),
  CloudGraph: withIconDefaults(IconCloudNodesOutlineDuo18),
  Copy: Nucleo.copy,
  Compass: Nucleo.compass,
  ChevronDown: Nucleo.chevronDown,
  ChevronRight: Nucleo.chevronRight,
  Dashboard: withIconDefaults(IconLayoutMainContentOutlineDuo18),
  Danger: Nucleo.alertWarning,
  Database: withIconDefaults(IconDatabaseOutlineDuo18),
  Graph: withIconDefaults(IconCloudNodesOutlineDuo18),
  Grid: Nucleo.grid,
  Home: Nucleo.house,
  Login: withIconDefaults(IconEnterDoorOutlineDuo18),
  Logout: withIconDefaults(IconExitDoorOutlineDuo18),
  Menu: Nucleo.menu,
  Monitor: Nucleo.monitor,
  Moon: Nucleo.moon,
  More: Nucleo.dots,
  Pen: Nucleo.pen,
  Pencil: Nucleo.pencil,
  Plug: Nucleo.plug,
  Plus: Nucleo.plus,
  Refresh: withIconDefaults(IconArrowRotateClockwiseOutlineDuo18),
  Scope: Nucleo.user,
  Search: Nucleo.search,
  Share: Nucleo.share,
  ShieldCheck: withIconDefaults(IconShieldCheckOutlineDuo18),
  Sidebar: Nucleo.layoutSidebar,
  SidebarCollapse: Nucleo.sidebarCollapse,
  SidebarExpand: Nucleo.sidebarExpand,
  Slack: SlackMark,
  Storage: withIconDefaults(IconStorageOutlineDuo18),
  Stack: Nucleo.stack,
  Star: Nucleo.star,
  Success: Nucleo.check,
  Sun: Nucleo.sun,
  Trash: Nucleo.trash,
  User: Nucleo.user,
  Warning: Nucleo.alertWarning,
  Workflow: withIconDefaults(IconNodes3OutlineDuo18),
  X: Nucleo.x,
} satisfies Record<string, AppIconComponent>;
