import type { Transition, Variants } from 'framer-motion';

/** 动效曲线（文档 5.5） */
export const EASE = {
  enter: [0.22, 1, 0.36, 1],
  exit: [0.55, 0, 1, 0.45],
  springy: [0.34, 1.56, 0.64, 1],
} as const;

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE.enter } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.18, ease: EASE.exit } },
};

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: EASE.enter } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: EASE.exit } },
};

/** 列表逐项延迟淡入：每项 delay 30ms */
export const listContainer: Variants = {
  animate: { transition: { staggerChildren: 0.03 } },
};

export const listItem: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE.enter } },
};

export const cardHover: Transition = { duration: 0.2, ease: EASE.enter };

export const likeTap = {
  scale: [1, 1.3, 1],
  transition: { duration: 0.3, ease: EASE.springy },
};

export const springSoft = { type: 'spring', stiffness: 380, damping: 32 } as const;

export const durationFast = 0.2;
