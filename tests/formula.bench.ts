import { parseFormula } from "./formula.ts";

const compact = "=SUM(A1:A100)+IF(B2>=10,B2*1.2,0)";
const complex =
	`=IF(SUM('Q1 Sales'!$B$2:B100)>=1000,AVERAGE(C:C)*1.2,ROUND(SUMPRODUCT(A1:A20,B1:B20),2))&" total"`;

Deno.bench("formula: compact", { group: "formula" }, () => {
	parseFormula(compact);
});

Deno.bench("formula: complex", { group: "formula" }, () => {
	parseFormula(complex);
});

Deno.bench("formula: 100 unique formulas", { group: "formula-batch" }, () => {
	for (let row = 1; row <= 100; row++) {
		parseFormula(`=IF(A${row}>0,SUM(B${row}:F${row})*1.2,0)`);
	}
});
