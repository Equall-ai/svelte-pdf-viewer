/* Copyright 2024 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * FindController - Text search functionality for PDF viewer.
 * This is a derivative work based on PDF.js pdf_find_controller.js and text_highlighter.js
 */
import type { EventBus } from './EventBus.js';
import type { PDFViewerCore } from './PDFViewerCore.js';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const FindState = {
	FOUND: 0,
	NOT_FOUND: 1,
	WRAPPED: 2,
	PENDING: 3
} as const;

export interface FindOptions {
	query: string;
	highlightAll?: boolean;
	caseSensitive?: boolean;
	entireWord?: boolean;
	findPrevious?: boolean;
	// 1-based page to anchor selection to: select the first match at or after this
	// page (forward-only), so a search after scrolling doesn't drag back to page 1.
	fromPage?: number;
}

interface MatchPosition {
	begin: { divIdx: number; offset: number };
	end: { divIdx: number; offset: number };
}

export class FindController {
	private viewer: PDFViewerCore;
	private eventBus: EventBus;
	private pdfDocument: PDFDocumentProxy | null = null;

	private query: string = '';
	private caseSensitive: boolean = false;
	private entireWord: boolean = false;
	private highlightAll: boolean = true;

	// Page text content extracted directly from PDF
	private pageContents: string[] = [];
	private extractTextPromises: Promise<void>[] = [];

	// Matches per page
	private pageMatches: number[][] = [];
	private pageMatchesLength: number[][] = [];

	// Flattened matches for navigation
	private allMatches: Array<{ pageIndex: number; matchIndex: number }> = [];
	private selectedMatchIndex: number = -1;
	private matchesCountTotal: number = 0;

	constructor(viewer: PDFViewerCore, eventBus: EventBus) {
		this.viewer = viewer;
		this.eventBus = eventBus;
		// Virtualized pages render (and re-render on scroll/scale) after a search runs,
		// rebuilding textDivs as plain text. Re-apply this page's highlights when it does.
		this.eventBus.on('pagerendered', this.onPageRendered);
	}

	private onPageRendered = (data: Record<string, unknown>): void => {
		const pageNumber = data.pageNumber as number | undefined;
		if (!pageNumber || !this.query) return;

		const pageIndex = pageNumber - 1;
		if (!this.pageMatches[pageIndex] || this.pageMatches[pageIndex].length === 0) return;

		this.highlightPage(pageIndex);
	};

	setDocument(pdfDocument: PDFDocumentProxy): void {
		this.pdfDocument = pdfDocument;
		this.pageContents = [];
		this.extractTextPromises = [];
		this.reset();
	}

	private async extractText(): Promise<void> {
		if (!this.pdfDocument || this.extractTextPromises.length > 0) {
			return;
		}

		const numPages = this.pdfDocument.numPages;

		for (let i = 0; i < numPages; i++) {
			const promise = (async () => {
				try {
					const page = await this.pdfDocument!.getPage(i + 1);
					// Don't use disableNormalization - let PDF.js normalize the text
					// This matches how TextLayer will render it
					const textContent = await page.getTextContent();

					const strBuf: string[] = [];
					for (const item of textContent.items) {
						if ('str' in item) {
							strBuf.push(item.str);
						}
					}

					// Join all text items directly (no separator)
					// This creates a searchable string that matches the concatenation
					// of all text spans in the rendered page
					this.pageContents[i] = strBuf.join('');
				} catch (e) {
					console.error(`Unable to get text content for page ${i + 1}`, e);
					this.pageContents[i] = '';
				}
			})();

			this.extractTextPromises[i] = promise;
		}

		await Promise.all(this.extractTextPromises);
	}

	async find(options: FindOptions): Promise<void> {
		const {
			query,
			highlightAll = true,
			caseSensitive = false,
			entireWord = false,
			findPrevious = false,
			fromPage
		} = options;

		// Clear previous state
		this.clearHighlights();

		if (!query || query.trim() === '') {
			this.query = '';
			this.allMatches = [];
			this.selectedMatchIndex = -1;
			this.matchesCountTotal = 0;
			this.eventBus.dispatch('updatefindmatchescount', {
				matchesCount: { current: 0, total: 0 }
			});
			return;
		}

		this.query = query;
		this.highlightAll = highlightAll;
		this.caseSensitive = caseSensitive;
		this.entireWord = entireWord;

		this.eventBus.dispatch('updatefindcontrolstate', {
			state: FindState.PENDING
		});

		// Extract text from PDF if not already done
		await this.extractText();

		// Search all pages
		this.pageMatches = [];
		this.pageMatchesLength = [];
		this.allMatches = [];
		this.matchesCountTotal = 0;

		const searchQuery = caseSensitive ? query : query.toLowerCase();

		for (let pageIndex = 0; pageIndex < this.pageContents.length; pageIndex++) {
			const pageContent = this.pageContents[pageIndex];
			const searchContent = caseSensitive ? pageContent : pageContent.toLowerCase();

			const matches: number[] = [];
			const matchesLength: number[] = [];

			let pos = 0;
			while ((pos = searchContent.indexOf(searchQuery, pos)) !== -1) {
				// Check entire word if required
				if (entireWord) {
					const before = pos > 0 ? searchContent[pos - 1] : ' ';
					const after =
						pos + searchQuery.length < searchContent.length
							? searchContent[pos + searchQuery.length]
							: ' ';
					if (/\w/.test(before) || /\w/.test(after)) {
						pos++;
						continue;
					}
				}

				matches.push(pos);
				matchesLength.push(searchQuery.length);

				this.allMatches.push({
					pageIndex,
					matchIndex: matches.length - 1
				});

				pos++;
			}

			this.pageMatches[pageIndex] = matches;
			this.pageMatchesLength[pageIndex] = matchesLength;
			this.matchesCountTotal += matches.length;
		}

		// Select first or last match based on direction
		if (this.allMatches.length > 0) {
			this.selectedMatchIndex = this.pickInitialMatch(findPrevious, fromPage);
			this.highlightAllPages();
			this.scrollToSelectedMatch();

			this.eventBus.dispatch('updatefindcontrolstate', {
				state: FindState.FOUND
			});
		} else {
			this.selectedMatchIndex = -1;
			this.eventBus.dispatch('updatefindcontrolstate', {
				state: FindState.NOT_FOUND
			});
		}

		this.eventBus.dispatch('updatefindmatchescount', {
			matchesCount: {
				current: this.selectedMatchIndex + 1,
				total: this.matchesCountTotal
			}
		});
	}

	// Choose the match to select after a fresh search. With `fromPage` set, prefer
	// the first match at or after that page so we never scroll backward; if none
	// exists at/after, fall back to the default end so the search still lands.
	private pickInitialMatch(findPrevious: boolean, fromPage?: number): number {
		const fallback = findPrevious ? this.allMatches.length - 1 : 0;
		if (fromPage == null) return fallback;

		const forwardIdx = this.allMatches.findIndex((m) => m.pageIndex >= fromPage - 1);
		return forwardIdx === -1 ? fallback : forwardIdx;
	}

	findNext(): void {
		if (this.allMatches.length === 0) return;

		this.selectedMatchIndex = (this.selectedMatchIndex + 1) % this.allMatches.length;
		this.highlightAllPages();
		this.scrollToSelectedMatch();

		const wrapped = this.selectedMatchIndex === 0;
		this.eventBus.dispatch('updatefindcontrolstate', {
			state: wrapped ? FindState.WRAPPED : FindState.FOUND
		});
		this.eventBus.dispatch('updatefindmatchescount', {
			matchesCount: {
				current: this.selectedMatchIndex + 1,
				total: this.matchesCountTotal
			}
		});
	}

	findPrevious(): void {
		if (this.allMatches.length === 0) return;

		this.selectedMatchIndex =
			(this.selectedMatchIndex - 1 + this.allMatches.length) % this.allMatches.length;
		this.highlightAllPages();
		this.scrollToSelectedMatch();

		const wrapped = this.selectedMatchIndex === this.allMatches.length - 1;
		this.eventBus.dispatch('updatefindcontrolstate', {
			state: wrapped ? FindState.WRAPPED : FindState.FOUND
		});
		this.eventBus.dispatch('updatefindmatchescount', {
			matchesCount: {
				current: this.selectedMatchIndex + 1,
				total: this.matchesCountTotal
			}
		});
	}

	private highlightAllPages(): void {
		this.clearHighlights();

		for (let pageIndex = 0; pageIndex < this.viewer.pagesCount; pageIndex++) {
			this.highlightPage(pageIndex);
		}
	}

	private highlightPage(pageIndex: number): void {
		const pageView = this.viewer.getPageView(pageIndex);
		if (!pageView) return;

		const matches = this.pageMatches[pageIndex];
		const matchesLength = this.pageMatchesLength[pageIndex];

		if (!matches || matches.length === 0) return;

		const textDivs = pageView.textDivs;
		const textContentItemsStr = pageView.textContentItemsStr;

		if (!textDivs || !textContentItemsStr || textContentItemsStr.length === 0) return;

		// Convert match positions to div positions
		const convertedMatches = this.convertMatches(matches, matchesLength, textContentItemsStr);

		// Find which match in allMatches corresponds to this page's selected match
		let selectedMatchOnPage = -1;
		if (this.selectedMatchIndex >= 0) {
			const selectedGlobal = this.allMatches[this.selectedMatchIndex];
			if (selectedGlobal.pageIndex === pageIndex) {
				selectedMatchOnPage = selectedGlobal.matchIndex;
			}
		}

		// Render the matches
		this.renderMatches(
			convertedMatches,
			textDivs,
			textContentItemsStr,
			selectedMatchOnPage,
			this.highlightAll
		);
	}

	private convertMatches(
		matches: number[],
		matchesLength: number[],
		textContentItemsStr: string[]
	): MatchPosition[] {
		if (!matches || matches.length === 0) {
			return [];
		}

		const result: MatchPosition[] = [];

		// Build cumulative text length array
		const textLengths: number[] = [];
		let totalLen = 0;
		for (const str of textContentItemsStr) {
			textLengths.push(totalLen);
			totalLen += str.length;
		}

		for (let m = 0; m < matches.length; m++) {
			const matchStart = matches[m];
			const matchEnd = matchStart + matchesLength[m];

			// Find the div containing the start of the match
			let beginDivIdx = 0;
			for (let i = 0; i < textLengths.length; i++) {
				if (
					i === textLengths.length - 1 ||
					(matchStart >= textLengths[i] &&
						matchStart < textLengths[i] + textContentItemsStr[i].length)
				) {
					beginDivIdx = i;
					break;
				}
			}

			// Find the div containing the end of the match
			let endDivIdx = beginDivIdx;
			for (let i = beginDivIdx; i < textLengths.length; i++) {
				if (
					i === textLengths.length - 1 ||
					matchEnd <= textLengths[i] + textContentItemsStr[i].length
				) {
					endDivIdx = i;
					break;
				}
			}

			result.push({
				begin: {
					divIdx: beginDivIdx,
					offset: matchStart - textLengths[beginDivIdx]
				},
				end: {
					divIdx: endDivIdx,
					offset: matchEnd - textLengths[endDivIdx]
				}
			});
		}

		return result;
	}

	private renderMatches(
		matches: MatchPosition[],
		textDivs: HTMLElement[],
		textContentItemsStr: string[],
		selectedMatchIdx: number,
		highlightAll: boolean
	): void {
		if (matches.length === 0) return;

		let prevEnd: { divIdx: number; offset: number } | null = null;
		const infinity = { divIdx: -1, offset: undefined as number | undefined };

		const beginText = (begin: { divIdx: number; offset: number }, className?: string): void => {
			const divIdx = begin.divIdx;
			textDivs[divIdx].textContent = '';
			appendTextToDiv(divIdx, 0, begin.offset, className);
		};

		const appendTextToDiv = (
			divIdx: number,
			fromOffset: number,
			toOffset: number | undefined,
			className?: string
		): void => {
			const div = textDivs[divIdx];
			if (!div) return;

			const text = textContentItemsStr[divIdx];
			const content = text.substring(fromOffset, toOffset);

			if (!content) return;

			const node = document.createTextNode(content);
			if (className) {
				const span = document.createElement('span');
				span.className = `${className} appended`;
				span.appendChild(node);
				div.appendChild(span);
			} else {
				div.appendChild(node);
			}
		};

		// Determine range of matches to highlight
		let i0 = selectedMatchIdx;
		let i1 = i0 + 1;
		if (highlightAll) {
			i0 = 0;
			i1 = matches.length;
		} else if (selectedMatchIdx < 0) {
			return;
		}

		let lastDivIdx = -1;
		let lastOffset = -1;

		for (let i = i0; i < i1; i++) {
			const match = matches[i];
			const begin = match.begin;

			// Skip duplicate matches at the same position (e.g., ligatures)
			if (begin.divIdx === lastDivIdx && begin.offset === lastOffset) {
				continue;
			}
			lastDivIdx = begin.divIdx;
			lastOffset = begin.offset;

			const end = match.end;
			const isSelected = i === selectedMatchIdx;
			const highlightSuffix = isSelected ? ' selected' : '';

			// Match inside new div
			if (!prevEnd || begin.divIdx !== prevEnd.divIdx) {
				// If there was a previous div, add remaining text
				if (prevEnd !== null) {
					appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset);
				}
				// Clear the div and set content until the match start
				beginText(begin);
			} else {
				// Same div as previous match - add text between matches
				appendTextToDiv(prevEnd.divIdx, prevEnd.offset, begin.offset);
			}

			if (begin.divIdx === end.divIdx) {
				// Single div match
				appendTextToDiv(begin.divIdx, begin.offset, end.offset, 'highlight' + highlightSuffix);
			} else {
				// Multi-div match
				// Highlight from begin to end of first div
				appendTextToDiv(
					begin.divIdx,
					begin.offset,
					infinity.offset,
					'highlight begin' + highlightSuffix
				);

				// Highlight entire middle divs
				for (let n = begin.divIdx + 1; n < end.divIdx; n++) {
					textDivs[n].className = 'highlight middle' + highlightSuffix;
				}

				// Start end div and highlight up to match end
				beginText(end, 'highlight end' + highlightSuffix);
			}
			prevEnd = end;
		}

		// Add remaining text after last match
		if (prevEnd) {
			appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset);
		}
	}

	private scrollToSelectedMatch(): void {
		if (this.selectedMatchIndex === -1) return;

		const match = this.allMatches[this.selectedMatchIndex];
		if (!match) return;

		// First scroll to the page
		this.viewer.scrollToPage(match.pageIndex + 1);

		// Then scroll to the highlighted element only if it's not already visible
		setTimeout(() => {
			const selectedElement = this.viewer.container.querySelector('.highlight.selected');
			if (selectedElement) {
				const container = this.viewer.container;
				const containerRect = container.getBoundingClientRect();
				const elementRect = selectedElement.getBoundingClientRect();

				// Check if element is visible within the container
				const isVisible =
					elementRect.top >= containerRect.top &&
					elementRect.bottom <= containerRect.bottom &&
					elementRect.left >= containerRect.left &&
					elementRect.right <= containerRect.right;

				if (!isVisible) {
					selectedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			}
		}, 100);
	}

	private clearHighlights(): void {
		// Clear all highlights from all pages
		for (let pageIndex = 0; pageIndex < this.viewer.pagesCount; pageIndex++) {
			const pageView = this.viewer.getPageView(pageIndex);
			if (!pageView) continue;

			const textDivs = pageView.textDivs;
			const textContentItemsStr = pageView.textContentItemsStr;

			if (!textDivs || !textContentItemsStr) continue;

			for (let i = 0; i < textDivs.length; i++) {
				const div = textDivs[i];
				if (div) {
					div.textContent = textContentItemsStr[i] || '';
					div.className = '';
				}
			}
		}
	}

	get matchesCount(): { current: number; total: number } {
		return {
			current: this.selectedMatchIndex + 1,
			total: this.matchesCountTotal
		};
	}

	// Match count per requested page (1-based page numbers).
	getPageMatchCounts(pages: number[]): Array<{ page: number; matchCount: number }> {
		return pages.map((page) => ({
			page,
			matchCount: this.pageMatches[page - 1]?.length ?? 0
		}));
	}

	reset(): void {
		this.clearHighlights();
		this.query = '';
		this.allMatches = [];
		this.pageMatches = [];
		this.pageMatchesLength = [];
		this.selectedMatchIndex = -1;
		this.matchesCountTotal = 0;
	}
}
