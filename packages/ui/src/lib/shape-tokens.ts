interface ShapeClasses {
  readonly item: string;
  readonly bg: string;
  readonly focusRing: string;
  readonly mergedBg: string;
  readonly container: string;
  readonly button: string;
  readonly input: string;
  readonly bgRadius: number;
  readonly mergedRadius: number;
}

/** Fixed rounded shape tokens shared by the Fluid component layer. */
const roundedShape = {
  item: "rounded-lg",
  bg: "rounded-lg",
  focusRing: "rounded-[10px]",
  mergedBg: "rounded-lg",
  container: "rounded-xl",
  button: "rounded-lg",
  input: "rounded-full",
  bgRadius: 8,
  mergedRadius: 8,
} as const satisfies ShapeClasses;

export { roundedShape };
