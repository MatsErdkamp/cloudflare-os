"use client";

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";

/** Props shared by every icon rendered through a Fluid component slot. */
export interface IconComponentProps extends Omit<SVGProps<SVGSVGElement>, "size" | "strokeWidth"> {
  size?: number;
  strokeWidth?: number;
  title?: string;
}

/** A product icon component accepted by Fluid Functionalism. */
export type IconComponent = ComponentType<IconComponentProps>;

/** Every named icon slot exposed by the installed Fluid components. */
export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "x"
  | "copy"
  | "menu"
  | "dot"
  | "monitor"
  | "sun"
  | "moon"
  | "rectangle-horizontal"
  | "circle"
  | "square-library"
  | "clock"
  | "star"
  | "settings"
  | "plus"
  | "arrow-left"
  | "arrow-right"
  | "arrow-up"
  | "search"
  | "loader"
  | "users"
  | "lock"
  | "mail"
  | "bell"
  | "shield"
  | "palette"
  | "lightbulb"
  | "rocket"
  | "heart"
  | "paintbrush"
  | "brain"
  | "globe"
  | "user"
  | "image"
  | "link"
  | "check"
  | "rotate-ccw"
  | "play"
  | "pause"
  | "pipette"
  | "home"
  | "message-circle"
  | "inbox"
  | "pencil"
  | "skip-forward"
  | "corner-down-right";

const IconContext = createContext<Record<IconName, IconComponent> | null>(null);

/** Returns a single configured product icon component for the given Fluid slot. */
function useIcon(name: IconName): IconComponent {
  const icons = useContext(IconContext);
  if (!icons) {
    throw new Error("useIcon must be used within an IconProvider");
  }
  return icons[name];
}

/** Returns the complete configured product icon map. */
function useIcons(): Record<IconName, IconComponent> {
  const icons = useContext(IconContext);
  if (!icons) {
    throw new Error("useIcons must be used within an IconProvider");
  }
  return icons;
}

/** Supplies every named Fluid icon slot from the product's icon system. */
function IconProvider({
  children,
  icons,
}: {
  children: ReactNode;
  icons: Record<IconName, IconComponent>;
}) {
  return <IconContext.Provider value={icons}>{children}</IconContext.Provider>;
}

export { IconProvider, useIcon, useIcons };
