import { assertEquals } from "https://deno.land/std@0.215.0/assert/mod.ts";
// import { assertSnapshot } from "testing/snapshot.ts";

import { parser } from "./css.ts";

Deno.test(`parses ""`, () => {
	assertEquals(parser(""), []);
});

Deno.test(`more complex css`, () => {
	const input = `
		.class,
		.second {
		  color: red;
		  background-color: #fff;
		}

		#next {}

		.poop {
		  font-size: 20px !important;
		}
	`;
	const expectation = [
		{
			type: "ruleset",
			selectors: [
				{
					type: "selector",
					scope: "class",
					name: "class",
				},
				{
					type: "selector",
					scope: "class",
					name: "second",
				},
			],
			rules: [
				{
					type: "rule",
					name: "color",
					value: "red",
					important: false,
				},
				{
					type: "rule",
					name: "background-color",
					value: "#fff",
					important: false,
				},
			],
		},
		{
			type: "ruleset",
			selectors: [
				{
					type: "selector",
					scope: "id",
					name: "next",
				},
			],
			rules: [],
		},
		{
			type: "ruleset",
			selectors: [
				{
					type: "selector",
					scope: "class",
					name: "poop",
				},
			],
			rules: [
				{
					type: "rule",
					name: "font-size",
					value: {
						type: "size",
						value: 20,
						unit: "px",
					},
					important: true,
				},
			],
		},
	];
	assertEquals(parser(input), expectation);
});
