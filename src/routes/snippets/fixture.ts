/** Generate deterministic review evidence, including rotation and offset CropBoxes. */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import type { NormalizedBoundingBox } from '$lib/index.js';
type Citation = NormalizedBoundingBox & { id: string };

export interface DemoEvent {
	id: string;
	title: string;
	detail: string;
	date: string;
	citations: Citation[];
}
const citation = (
	id: string,
	page: number,
	top: number,
	bottom: number,
	left = 48,
	right = 558
): Citation => ({
	id,
	page,
	x_min: (left / 612) * 100,
	x_max: (right / 612) * 100,
	y_min: (top / 792) * 100,
	y_max: (bottom / 792) * 100
});
export const events: DemoEvent[] = [
	{
		id: 'series-a',
		title: 'Series A issuance',
		date: 'May 14, 2026',
		detail: '1,000,000 shares at $2.00 per share',
		citations: [
			citation('issuance', 2, 202, 235),
			citation('price', 2, 245, 264),
			citation('purchaser', 5, 280, 306)
		]
	},
	{
		id: 'closing',
		title: 'Closing conditions',
		date: 'May 14, 2026',
		detail: 'Board approval and purchaser obligations',
		citations: [citation('price', 2, 245, 264), citation('conditions', 2, 580, 615)]
	},
	{
		id: 'geometry',
		title: 'Execution & registration',
		date: 'May 15, 2026',
		detail: 'Rotated page and offset crop evidence',
		citations: [citation('rotated', 6, 202, 235), citation('offset', 7, 202, 235)]
	},
	{
		id: 'empty',
		title: 'Future option grant',
		date: 'Pending',
		detail: 'No supporting passages attached',
		citations: []
	}
];

/** Build seven readable pages with predictable positions for browser validation. */
export async function createFixture(includeForm = false): Promise<Uint8Array> {
	const pdf = await PDFDocument.create();
	pdf.setCreationDate(new Date('2026-05-14T12:00:00Z'));
	pdf.setModificationDate(new Date('2026-05-14T12:00:00Z'));
	const font = await pdf.embedFont(StandardFonts.TimesRoman);
	const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
	for (let number = 1; number <= 7; number++) {
		const page = pdf.addPage([612, 792]);
		const text = (value: string, top: number, size = 12, strong = false) =>
			page.drawText(value, {
				x: 48,
				y: 792 - top,
				size,
				font: strong ? bold : font,
				color: rgb(0.12, 0.16, 0.22)
			});
		text('NORTHSTAR TECHNOLOGIES, INC.', 55, 11, true);
		text(
			number === 5 ? 'Schedule A — Purchasers' : 'Series A Stock Purchase Agreement',
			90,
			22,
			true
		);
		text(
			`Section ${number}. ${['Overview', 'Purchase and sale', 'Representations', 'Covenants', 'Purchasers', 'Execution', 'Registration'][number - 1]}`,
			145,
			14,
			true
		);
		text('This agreement records the terms agreed by the Company and the Purchasers.', 176);
		if (number === 5) {
			text('The following purchaser subscribes for the securities set out below.', 220);
			text(
				'Purchaser                          Shares                    Purchase price',
				270,
				12,
				true
			);
			text('Acme Ventures                   1,000,000                $2,000,000', 298);
			page.drawLine({ start: { x: 48, y: 516 }, end: { x: 558, y: 516 }, thickness: 0.6 });
		} else {
			text(
				number === 6
					? 'Executed by the Company and duly authorized by its Board.'
					: number === 7
						? 'The transfer agent shall record the issuance in the register.'
						: 'The Company shall issue 1,000,000 shares of Series A Preferred Stock.',
				218
			);
			text('The securities carry the rights set out in the amended certificate.', 234);
			text('The purchase price shall be $2.00 per share, payable at Closing.', 260);
		}
		for (let top = 345; top <= 525; top += 30)
			text(
				`Clause ${number}.${(top - 345) / 30 + 1}. Each party shall deliver the documents required under this agreement.`,
				top
			);
		text('Closing is subject to Board approval and receipt of the purchase price.', 596);
		text('Each Purchaser shall deliver an executed counterpart before Closing.', 612);
		text('Notices shall be given in writing to the addresses maintained by the Company.', 684);
		text(
			`Northstar Technologies / Confidential                                              ${number}`,
			750,
			10
		);
	}
	// Embed upright artwork inversely so the intrinsically rotated source reads normally.
	const original = pdf.getPages()[5];
	const rotated = pdf.insertPage(5, [792, 612]);
	const embedded = await pdf.embedPage(original);
	rotated.drawPage(embedded, { x: 792, y: 0, rotate: degrees(90) });
	rotated.setRotation(degrees(90));
	pdf.removePage(6);
	const last = pdf.getPages()[6];
	last.translateContent(36, 48);
	last.setMediaBox(0, 0, 684, 888);
	last.setCropBox(36, 48, 612, 792);
	if (includeForm) {
		const field = pdf.getForm().createTextField('review-note');
		field.setText('Source-only form example');
		field.addToPage(pdf.getPage(1), { x: 48, y: 680, width: 270, height: 22 });
	}
	return pdf.save();
}
