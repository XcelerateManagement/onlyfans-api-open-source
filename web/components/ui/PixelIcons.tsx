"use client";

/**
 * Pixel-art dot-matrix icons.
 * Each icon is drawn on a 7×7 grid (positions: 2.4, 5.6, 8.8, 12, 15.2, 18.4, 21.6)
 * using square stroke-linecap dots at stroke-width="2".
 *
 * All icons accept className and size props. Use `currentColor` for stroke by default.
 */

import { SVGProps } from "react";

interface PixelIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

// Grid positions on the 24×24 canvas
// 0=2.4  1=5.6  2=8.8  3=12  4=15.2  5=18.4  6=21.6
const G = [2.4, 5.6, 8.8, 12, 15.2, 18.4, 21.6];

/** Render dots at given [col, row] positions */
function Dots({
  dots,
  opacity = 1,
}: {
  dots: [number, number][];
  opacity?: number;
}) {
  return (
    <>
      {dots.map(([c, r], i) => (
        <path
          key={i}
          stroke="currentColor"
          strokeLinecap="square"
          strokeWidth="2"
          strokeOpacity={opacity}
          d={`M${G[c]} ${G[r]}h.008`}
        />
      ))}
    </>
  );
}

function Icon({ size = 24, children, className, ...props }: PixelIconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      {...props}
    >
      {children}
    </svg>
  );
}

// ─── Sidebar Navigation Icons ───

/** 4-square grid — Dashboard/Overview */
export function PxLayoutDashboard(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,0],[1,0],[2,0],  [4,0],[5,0],[6,0],
        [0,1],[1,1],[2,1],  [4,1],[5,1],[6,1],
        [0,2],[1,2],[2,2],  [4,2],[5,2],[6,2],
        [0,4],[1,4],[2,4],  [4,4],[5,4],[6,4],
        [0,5],[1,5],[2,5],  [4,5],[5,5],[6,5],
        [0,6],[1,6],[2,6],  [4,6],[5,6],[6,6],
      ]} />
      <Dots dots={[[3,0],[3,1],[3,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],[3,4],[3,5],[3,6]]} opacity={0.01} />
    </Icon>
  );
}

/** Two people — Accounts/Users */
export function PxUsers(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Person 1 head */}
      <Dots dots={[[1,0],[2,0],[1,1],[2,1]]} />
      {/* Person 1 body */}
      <Dots dots={[[0,3],[1,3],[2,3],[3,3],[0,4],[3,4],[0,5],[3,5]]} />
      {/* Person 2 head */}
      <Dots dots={[[4,1],[5,1],[4,2],[5,2]]} />
      {/* Person 2 body */}
      <Dots dots={[[3,4],[4,4],[5,4],[6,4],[3,5],[6,5],[3,6],[6,6]]} />
      <Dots dots={[[0,6],[3,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Single person — User */
export function PxUser(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Head */}
      <Dots dots={[[2,0],[3,0],[4,0],[2,1],[3,1],[4,1]]} />
      {/* Body */}
      <Dots dots={[[1,3],[2,3],[3,3],[4,3],[5,3],[0,4],[1,4],[5,4],[6,4],[0,5],[6,5],[0,6],[6,6]]} />
      <Dots dots={[[2,2],[3,2],[4,2]]} opacity={0.25} />
    </Icon>
  );
}

/** Person with check — Subscribers */
export function PxUserCheck(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Head */}
      <Dots dots={[[1,0],[2,0],[1,1],[2,1]]} />
      {/* Body */}
      <Dots dots={[[0,3],[1,3],[2,3],[3,3],[0,4],[3,4],[0,5],[3,5],[0,6],[3,6]]} />
      {/* Checkmark */}
      <Dots dots={[[4,3],[5,4],[6,3]]} />
      <Dots dots={[[5,2]]} opacity={0.25} />
    </Icon>
  );
}

/** Dollar sign — Earnings */
export function PxDollarSign(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [3,0],
        [2,1],[3,1],[4,1],[5,1],
        [1,2],[2,2],
        [2,3],[3,3],[4,3],
        [4,4],[5,4],
        [1,5],[2,5],[3,5],[4,5],
        [3,6],
      ]} />
      <Dots dots={[[1,1],[5,5]]} opacity={0.25} />
    </Icon>
  );
}

/** Megaphone — Campaigns */
export function PxMegaphone(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [5,0],
        [4,1],[5,1],
        [0,2],[1,2],[2,2],[3,2],[4,2],
        [0,3],[1,3],[2,3],[3,3],
        [0,4],[1,4],[2,4],[3,4],[4,4],
        [4,5],[5,5],
        [5,6],
      ]} />
      <Dots dots={[[6,1],[6,2],[6,5],[6,4],[1,5],[1,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Bell — Notifications */
export function PxBell(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [3,0],
        [2,1],[3,1],[4,1],
        [1,2],[2,2],[4,2],[5,2],
        [1,3],[5,3],
        [1,4],[5,4],
        [0,5],[1,5],[2,5],[3,5],[4,5],[5,5],[6,5],
        [3,6],
      ]} />
      <Dots dots={[[2,6],[4,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Open book — API Docs */
export function PxBookOpen(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,1],[3,1],[6,1],
        [0,2],[1,2],[3,2],[5,2],[6,2],
        [0,3],[1,3],[3,3],[5,3],[6,3],
        [0,4],[1,4],[3,4],[5,4],[6,4],
        [0,5],[3,5],[6,5],
      ]} />
      <Dots dots={[[3,0],[3,6],[2,2],[4,2],[2,4],[4,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Gear — Settings */
export function PxSettings(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [3,0],
        [2,1],[3,1],[4,1],
        [0,2],[1,2],[5,2],[6,2],
        [0,3],[3,3],[6,3],
        [0,4],[1,4],[5,4],[6,4],
        [2,5],[3,5],[4,5],
        [3,6],
      ]} />
      <Dots dots={[[2,3],[4,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Receipt — Transactions */
export function PxReceipt(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [1,0],[2,0],[3,0],[4,0],[5,0],
        [1,1],[5,1],
        [2,2],[3,2],[4,2],
        [1,3],[5,3],
        [2,4],[3,4],
        [1,5],[5,5],
        [1,6],[3,6],[5,6],
      ]} />
      <Dots dots={[[2,5],[3,5],[4,5]]} opacity={0.25} />
    </Icon>
  );
}

/** Document with lines — FileText / API Reference */
export function PxFileText(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [1,0],[2,0],[3,0],[4,0],
        [1,1],[4,1],[5,1],
        [1,2],[5,2],
        [2,3],[3,3],[4,3],
        [2,4],[3,4],
        [2,5],[3,5],[4,5],
        [1,6],[2,6],[3,6],[4,6],[5,6],
      ]} />
      <Dots dots={[[1,3],[1,4],[1,5],[5,3],[5,4],[5,5]]} opacity={0.25} />
    </Icon>
  );
}

/** Crown — Admin badge */
export function PxCrown(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,1],[3,1],[6,1],
        [0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],
        [0,3],[1,3],[2,3],[4,3],[5,3],[6,3],
        [0,4],[1,4],[2,4],[3,4],[4,4],[5,4],[6,4],
        [0,5],[6,5],
      ]} />
      <Dots dots={[[3,3]]} opacity={0.25} />
    </Icon>
  );
}

// ─── Action Icons ───

/** Left chevron — Collapse sidebar */
export function PxChevronLeft(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[[4,1],[3,2],[2,3],[3,4],[4,5]]} />
      <Dots dots={[[5,0],[4,2],[3,3],[4,4],[5,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Right chevron — Expand sidebar */
export function PxChevronRight(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[[2,1],[3,2],[4,3],[3,4],[2,5]]} />
      <Dots dots={[[1,0],[3,1],[4,2],[4,4],[3,5],[1,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Down chevron */
export function PxChevronDown(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[[1,2],[2,3],[3,4],[4,3],[5,2]]} />
      <Dots dots={[[0,1],[2,2],[3,3],[4,2],[6,1]]} opacity={0.25} />
    </Icon>
  );
}

/** Up chevron */
export function PxChevronUp(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[[1,4],[2,3],[3,2],[4,3],[5,4]]} />
      <Dots dots={[[0,5],[2,4],[3,3],[4,4],[6,5]]} opacity={0.25} />
    </Icon>
  );
}

/** Plus sign — Add buttons */
export function PxPlus(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [3,1],
        [3,2],
        [1,3],[2,3],[3,3],[4,3],[5,3],
        [3,4],
        [3,5],
      ]} />
      <Dots dots={[[3,0],[3,6],[0,3],[6,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Checkmark */
export function PxCheck(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[[1,3],[2,4],[3,5],[4,4],[5,3],[6,2]]} />
      <Dots dots={[[0,2],[1,4],[5,2],[6,1]]} opacity={0.25} />
    </Icon>
  );
}

/** Log out arrow — Logout */
export function PxLogOut(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Door */}
      <Dots dots={[[0,0],[1,0],[2,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[1,6],[2,6]]} />
      {/* Arrow */}
      <Dots dots={[[3,3],[4,3],[5,3],[6,3],[5,2],[5,4]]} />
      <Dots dots={[[6,2],[6,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Envelope — Mail */
export function PxMail(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],
        [0,2],[1,2],[5,2],[6,2],
        [0,3],[2,3],[4,3],[6,3],
        [0,4],[3,4],[6,4],
        [0,5],[6,5],
        [0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],
      ]} />
      <Dots dots={[[3,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Padlock — Lock */
export function PxLock(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Shackle */}
      <Dots dots={[[2,0],[3,0],[4,0],[1,1],[5,1],[1,2],[5,2]]} />
      {/* Body */}
      <Dots dots={[
        [0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],
        [0,4],[3,4],[6,4],
        [0,5],[3,5],[6,5],
        [0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],
      ]} />
      <Dots dots={[[2,4],[4,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Globe — Proxy/World */
export function PxGlobe(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [2,0],[3,0],[4,0],
        [1,1],[3,1],[5,1],
        [0,2],[3,2],[6,2],
        [0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],
        [0,4],[3,4],[6,4],
        [1,5],[3,5],[5,5],
        [2,6],[3,6],[4,6],
      ]} />
      <Dots dots={[[2,2],[4,2],[2,4],[4,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Funnel — Filter */
export function PxFilter(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],
        [1,1],[5,1],
        [2,2],[4,2],
        [3,3],
        [3,4],
        [3,5],
      ]} />
      <Dots dots={[[2,1],[4,1],[3,2],[3,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Magnifying glass — Search */
export function PxSearch(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [2,0],[3,0],[4,0],
        [1,1],[5,1],
        [0,2],[6,2],
        [0,3],[6,3],
        [1,4],[5,4],
        [2,5],[3,5],[4,5],[5,5],
        [6,6],
      ]} />
      <Dots dots={[[0,4],[6,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Eye — View/Claimers */
export function PxEye(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [2,1],[3,1],[4,1],
        [1,2],[3,2],[5,2],
        [0,3],[2,3],[3,3],[4,3],[6,3],
        [1,4],[3,4],[5,4],
        [2,5],[3,5],[4,5],
      ]} />
      <Dots dots={[[0,2],[6,2],[0,4],[6,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Money bill — Banknote/Payout */
export function PxBanknote(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],
        [0,2],[6,2],
        [0,3],[3,3],[6,3],
        [0,4],[6,4],
        [0,5],[1,5],[2,5],[3,5],[4,5],[5,5],[6,5],
      ]} />
      <Dots dots={[[2,3],[4,3],[1,3],[5,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Upward trend line — TrendingUp */
export function PxTrendingUp(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [5,0],[6,0],
        [6,1],
        [4,2],[5,2],
        [3,3],
        [2,4],
        [0,5],[1,5],
      ]} />
      <Dots dots={[[4,1],[1,4],[0,6],[6,2]]} opacity={0.25} />
    </Icon>
  );
}

/** Two overlapping squares — Copy */
export function PxCopy(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Back square */}
      <Dots dots={[[0,0],[1,0],[2,0],[3,0],[4,0],[0,1],[4,1],[0,2],[0,3],[0,4],[1,4],[2,4],[3,4],[4,4]]} />
      {/* Front square */}
      <Dots dots={[[2,2],[3,2],[4,2],[5,2],[6,2],[2,3],[6,3],[2,4],[6,4],[2,5],[6,5],[2,6],[3,6],[4,6],[5,6],[6,6]]} />
      <Dots dots={[[4,2],[2,4]]} opacity={0.25} />
    </Icon>
  );
}

/** Key — API Credentials */
export function PxKey(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [4,0],[5,0],
        [3,1],[6,1],
        [3,2],[6,2],
        [4,3],[5,3],
        [3,3],
        [2,4],
        [0,5],[1,5],
        [0,6],
      ]} />
      <Dots dots={[[1,4],[1,6],[2,5]]} opacity={0.25} />
    </Icon>
  );
}

/** Shield — Security */
export function PxShield(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [1,0],[2,0],[3,0],[4,0],[5,0],
        [0,1],[6,1],
        [0,2],[3,2],[6,2],
        [0,3],[3,3],[6,3],
        [1,4],[3,4],[5,4],
        [2,5],[3,5],[4,5],
        [3,6],
      ]} />
      <Dots dots={[[2,3],[4,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Code brackets — Code2 */
export function PxCode2(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Left bracket */}
      <Dots dots={[[2,1],[1,2],[1,3],[2,5]]} />
      {/* Right bracket */}
      <Dots dots={[[4,1],[5,2],[5,3],[4,5]]} />
      {/* Center dots */}
      <Dots dots={[[0,3],[1,4],[5,4],[6,3]]} opacity={0.25} />
      <Dots dots={[[3,0],[3,2],[3,3],[3,4],[3,6]]} opacity={0.25} />
    </Icon>
  );
}

/** Play triangle — Send/Execute */
export function PxPlay(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [1,0],[2,0],
        [1,1],[2,1],[3,1],
        [1,2],[2,2],[3,2],[4,2],
        [1,3],[2,3],[3,3],[4,3],[5,3],
        [1,4],[2,4],[3,4],[4,4],
        [1,5],[2,5],[3,5],
        [1,6],[2,6],
      ]} />
      <Dots dots={[[5,2],[5,4],[6,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Paint palette — Appearance */
export function PxPalette(props: PixelIconProps) {
  return (
    <Icon {...props}>
      {/* Palette outline */}
      <Dots dots={[
        [2,0],[3,0],[4,0],
        [1,1],[5,1],
        [0,2],[6,2],
        [0,3],[6,3],
        [0,4],[5,4],[6,4],
        [1,5],[4,5],
        [2,6],[3,6],
      ]} />
      {/* Color dots on palette */}
      <Dots dots={[[2,2],[4,2],[1,3],[3,4]]} />
      <Dots dots={[[3,1],[5,3]]} opacity={0.25} />
    </Icon>
  );
}

/** Paper-plane — Send */
export function PxSend(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],
        [1,2],[2,2],[3,2],[4,2],[5,2],
        [2,3],[3,3],[4,3],
        [2,4],[3,4],
        [3,5],
      ]} />
    </Icon>
  );
}

/** Paperclip — Attachment */
export function PxPaperclip(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [3,0],[4,0],
        [2,1],[5,1],
        [2,2],[4,2],[5,2],
        [2,3],[4,3],
        [2,4],[4,4],
        [2,5],[3,5],[4,5],
      ]} />
    </Icon>
  );
}

/** Smiley face — Emoji picker */
export function PxSmile(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [1,0],[2,0],[3,0],[4,0],[5,0],
        [0,1],[6,1],
        [0,2],[2,2],[4,2],[6,2],
        [0,3],[6,3],
        [0,4],[1,4],[5,4],[6,4],
        [0,5],[2,5],[3,5],[4,5],[6,5],
        [1,6],[2,6],[3,6],[4,6],[5,6],
      ]} />
    </Icon>
  );
}

/** Lightning bolt — Automations */
export function PxZap(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [4,0],
        [3,1],[4,1],
        [2,2],[3,2],[4,2],
        [1,3],[2,3],[3,3],[4,3],[5,3],
        [2,4],[3,4],[4,4],
        [2,5],[3,5],
        [2,6],
      ]} />
    </Icon>
  );
}

/** Chain link — Webhooks */
export function PxLink(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,1],[1,1],[2,1],
        [0,2],[2,2],
        [0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3],
        [4,4],[6,4],
        [4,5],[5,5],[6,5],
      ]} />
    </Icon>
  );
}

/** Pulse/activity waveform — Activity feed */
export function PxActivity(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,3],[1,3],
        [2,1],[2,2],[2,3],
        [3,3],[3,4],[3,5],
        [4,3],[4,4],
        [5,3],[6,3],
      ]} />
    </Icon>
  );
}

/** Circular refresh arrow — subscribers refresh action, retry, etc. */
export function PxRefresh(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [2,0],[3,0],[4,0],
        [1,1],[5,1],
        [0,2],[6,2],[5,2],
        [0,3],[6,3],
        [0,4],[1,4],[6,4],
        [1,5],[5,5],
        [2,6],[3,6],[4,6],
      ]} />
    </Icon>
  );
}

/** Panel left icon — Sidebar trigger */
export function PxPanelLeft(props: PixelIconProps) {
  return (
    <Icon {...props}>
      <Dots dots={[
        [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0],
        [0,1],[2,1],[6,1],
        [0,2],[2,2],[6,2],
        [0,3],[2,3],[6,3],
        [0,4],[2,4],[6,4],
        [0,5],[2,5],[6,5],
        [0,6],[1,6],[2,6],[3,6],[4,6],[5,6],[6,6],
      ]} />
      <Dots dots={[[1,1],[1,2],[1,3],[1,4],[1,5]]} opacity={0.25} />
    </Icon>
  );
}
