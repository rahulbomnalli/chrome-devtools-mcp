/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {ElementHandle, Locator} from '../third_party/index.js';
import type {ContextPage} from '../tools/ToolDefinition.js';
import {HyperErrorCode, type LocatorTarget} from './types.js';

export class LocatorResolutionError extends Error {
  readonly code: HyperErrorCode;

  constructor(
    message: string,
    code: HyperErrorCode = HyperErrorCode.LOCATOR_NOT_FOUND,
  ) {
    super(message);
    this.name = 'LocatorResolutionError';
    this.code = code;
  }
}

function escapeCssAttribute(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

export class LocatorResolver {
  static async resolveHandle(
    page: ContextPage,
    target: LocatorTarget,
  ): Promise<ElementHandle<Element>> {
    const locator = this.resolveLocator(page, target);
    if (locator) {
      const handle = await locator.waitHandle();
      return handle;
    }

    if (target.uid) {
      try {
        const handle = await page.getElementByUid(target.uid);
        return handle;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new LocatorResolutionError(
          `Failed to resolve UID ${target.uid}: ${msg}`,
          HyperErrorCode.STALE_ELEMENT,
        );
      }
    }

    throw new LocatorResolutionError(
      'Target does not specify any valid locator mechanism.',
      HyperErrorCode.VALIDATION_ERROR,
    );
  }

  static resolveLocator(
    page: ContextPage,
    target: LocatorTarget,
  ): Locator<Element> | undefined {
    const pptr = page.pptrPage;

    // Priority 1: CSS selector
    const cssSel = target.css ?? target.selector;
    if (cssSel) {
      return pptr.locator(cssSel);
    }

    // Priority 2: Accessible Name / Role
    if (target.name && target.role) {
      return pptr.locator(
        `aria/[name="${escapeCssAttribute(target.name)}"][role="${escapeCssAttribute(target.role)}"]`,
      );
    }
    if (target.role && !target.name) {
      return pptr.locator(`[role="${escapeCssAttribute(target.role)}"]`);
    }
    if (target.name && !target.role) {
      return pptr.locator(`aria/${target.name}`);
    }

    // Priority 3: Associated Placeholder
    if (target.placeholder) {
      return pptr.locator(
        `[placeholder="${escapeCssAttribute(target.placeholder)}"]`,
      );
    }

    // Priority 4: Associated Label
    if (target.label) {
      return pptr.locator(`::-p-text(${JSON.stringify(target.label)})`);
    }

    // Priority 5: Visible Text
    if (target.text) {
      return pptr.locator(`::-p-text(${JSON.stringify(target.text)})`);
    }

    // Priority 6: XPath
    if (target.xpath) {
      return pptr.locator(`::-p-xpath(${JSON.stringify(target.xpath)})`);
    }

    return undefined;
  }

  static async assertNotAmbiguous(
    page: ContextPage,
    target: LocatorTarget,
  ): Promise<void> {
    if (target.css) {
      const count = await page.pptrPage.$$eval(
        target.css,
        elements => elements.length,
      );
      if (count > 1) {
        throw new LocatorResolutionError(
          `Target CSS selector "${target.css}" matches ${count} elements. Ambiguous target.`,
          HyperErrorCode.AMBIGUOUS_TARGET,
        );
      }
    }
  }
}
