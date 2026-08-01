// deno-lint-ignore-file no-import-prefix
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
		div {}

		.poop {
		  font-size: 20px !important;
		}
	`;
  const expectation = [
    {
      type: "ruleset",
      selectors: [
        [{
          type: "selector",
          scope: "class",
          name: "class",
        }],
        [{
          type: "selector",
          scope: "class",
          name: "second",
        }],
      ],
      rules: [
        {
          type: "rule",
          name: { type: "literal", name: "color" },
          value: ["red"],
          important: false,
        },
        {
          type: "rule",
          name: { type: "literal", name: "background-color" },
          value: ["#fff"],
          important: false,
        },
      ],
    },
    {
      type: "ruleset",
      selectors: [[
        {
          type: "selector",
          scope: "id",
          name: "next",
        },
      ]],
      rules: [],
    },
    {
      type: "ruleset",
      selectors: [[
        {
          type: "selector",
          scope: "tag",
          name: "div",
        },
      ]],
      rules: [],
    },
    {
      type: "ruleset",
      selectors: [[
        {
          type: "selector",
          scope: "class",
          name: "poop",
        },
      ]],
      rules: [
        {
          type: "rule",
          name: { type: "literal", name: "font-size" },
          value: [{
            type: "size",
            value: 20,
            unit: "px",
          }],
          important: true,
        },
      ],
    },
  ];
  assertEquals(parser(input), expectation);
});

Deno.test(`css selectors`, () => {
  const input = `
		body,
		#id,
		.class,
		[attr],
		[attr=true],
		[attr="a b"],
		.a .b,
		a.b,
		a#b.c,
		a > .b + #c | [c] ~ d,
		a.b > c#d + e,
		* {}
	`;
  const expectation = [
    {
      rules: [],
      selectors: [
        [
          {
            name: "body",
            scope: "tag",
            type: "selector",
          },
        ],
        [
          {
            name: "id",
            scope: "id",
            type: "selector",
          },
        ],
        [
          {
            name: "class",
            scope: "class",
            type: "selector",
          },
        ],
        [
          {
            name: "attr",
            scope: "attribute",
            type: "selector",
            value: undefined,
          },
        ],
        [
          {
            name: "attr",
            scope: "attribute",
            type: "selector",
            value: {
              case: undefined,
              operator: undefined,
              type: "attribute-value",
              value: "true",
            },
          },
        ],
        [
          {
            name: "attr",
            scope: "attribute",
            type: "selector",
            value: {
              case: undefined,
              operator: undefined,
              type: "attribute-value",
              value: "a b",
            },
          },
        ],
        {
          scope: "combinator",
          type: "selector",
          value: [
            [{
              name: "a",
              scope: "class",
              type: "selector",
            }],
            " ",
            {
              name: "b",
              scope: "class",
              type: "selector",
            },
          ],
        },
        [
          {
            name: "a",
            scope: "tag",
            type: "selector",
          },
          {
            name: "b",
            scope: "class",
            type: "selector",
          },
        ],
        [
          {
            name: "a",
            scope: "tag",
            type: "selector",
          },
          {
            name: "b",
            scope: "id",
            type: "selector",
          },
          {
            name: "c",
            scope: "class",
            type: "selector",
          },
        ],
        {
          scope: "separator",
          type: "selector",
          value: [
            {
              scope: "combinator",
              type: "selector",
              value: [
                [
                  {
                    name: "a",
                    scope: "tag",
                    type: "selector",
                  },
                ],
                ">",
                {
                  scope: "combinator",
                  type: "selector",
                  value: [
                    [
                      {
                        name: "b",
                        scope: "class",
                        type: "selector",
                      },
                    ],
                    "+",
                    {
                      name: "c",
                      scope: "id",
                      type: "selector",
                    },
                  ],
                },
              ],
            },
            "|",
            {
              scope: "combinator",
              type: "selector",
              value: [
                [
                  {
                    name: "c",
                    scope: "attribute",
                    type: "selector",
                    value: undefined,
                  },
                ],
                "~",
                {
                  name: "d",
                  scope: "tag",
                  type: "selector",
                },
              ],
            },
          ],
        },
        {
          scope: "combinator",
          type: "selector",
          value: [
            [
              {
                name: "a",
                scope: "tag",
                type: "selector",
              },
              {
                name: "b",
                scope: "class",
                type: "selector",
              },
            ],
            ">",
            {
              scope: "combinator",
              type: "selector",
              value: [
                [
                  {
                    name: "c",
                    scope: "tag",
                    type: "selector",
                  },
                  {
                    name: "d",
                    scope: "id",
                    type: "selector",
                  },
                ],
                "+",
                {
                  name: "e",
                  scope: "tag",
                  type: "selector",
                },
              ],
            },
          ],
        },
        [
          {
            scope: "all",
            type: "selector",
          },
        ],
      ],
      type: "ruleset",
    },
  ];
  assertEquals(parser(input), expectation);
});

Deno.test(`more complex css 2`, () => {
  const input = `
    :root {
      --a: 123;
    }

    body[data-color^="i-red" i] {
      color: var(--a, red);
    }
  `;
  const expectation = [
    {
      rules: [
        {
          important: false,
          name: {
            name: "a",
            type: "variable",
          },
          type: "rule",
          value: [
            {
              type: "size",
              unit: undefined,
              value: 123,
            },
          ],
        },
      ],
      selectors: [
        [
          {
            name: "root",
            scope: "pseudo",
            type: "selector",
            value: undefined,
            double: false,
          },
        ],
      ],
      type: "ruleset",
    },
    {
      rules: [
        {
          important: false,
          name: {
            name: "color",
            type: "literal",
          },
          type: "rule",
          value: [
            {
              name: "var",
              type: "fn",
              value: [
                [
                  {
                    name: "a",
                    type: "variable",
                  },
                ],
                [
                  "red",
                ],
              ],
            },
          ],
        },
      ],
      selectors: [
        [
          {
            name: "body",
            scope: "tag",
            type: "selector",
          },
          {
            name: "data-color",
            scope: "attribute",
            type: "selector",
            value: {
              case: "i",
              operator: "^",
              type: "attribute-value",
              value: "i-red",
            },
          },
        ],
      ],
      type: "ruleset",
    },
  ];
  assertEquals(parser(input), expectation);
});

Deno.test(`keyframes`, () => {
  const input = `
    @keyframes slidein {
      from {
        transform: translateX(0%);
      }

      to {
        transform: translateX(100%);
      }
    }

    @keyframes identifier {
      0% {
        top: 0;
        left: 0;
      }
      30% {
        top: 50px;
      }
      68%,
      72% {
        left: 50px;
      }
      100% {
        top: 100px;
        left: 100%;
      }
    }
  `;
  const expectation = [
    {
      name: "slidein",
      ruleset: [
        {
          rules: [
            {
              important: false,
              name: {
                name: "transform",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  name: "translateX",
                  type: "fn",
                  value: [
                    [
                      {
                        type: "size",
                        unit: "%",
                        value: 0,
                      },
                    ],
                  ],
                },
              ],
            },
          ],
          selectors: [
            "from",
          ],
          type: "frame",
        },
        {
          rules: [
            {
              important: false,
              name: {
                name: "transform",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  name: "translateX",
                  type: "fn",
                  value: [
                    [
                      {
                        type: "size",
                        unit: "%",
                        value: 100,
                      },
                    ],
                  ],
                },
              ],
            },
          ],
          selectors: [
            "to",
          ],
          type: "frame",
        },
      ],
      scope: "keyframes",
      type: "atrule",
    },
    {
      name: "identifier",
      ruleset: [
        {
          rules: [
            {
              important: false,
              name: {
                name: "top",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "size",
                  unit: undefined,
                  value: 0,
                },
              ],
            },
            {
              important: false,
              name: {
                name: "left",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "size",
                  unit: undefined,
                  value: 0,
                },
              ],
            },
          ],
          selectors: [
            0,
          ],
          type: "frame",
        },
        {
          rules: [
            {
              important: false,
              name: {
                name: "top",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "size",
                  unit: "px",
                  value: 50,
                },
              ],
            },
          ],
          selectors: [
            30,
          ],
          type: "frame",
        },
        {
          rules: [
            {
              important: false,
              name: {
                name: "left",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "size",
                  unit: "px",
                  value: 50,
                },
              ],
            },
          ],
          selectors: [
            68,
            72,
          ],
          type: "frame",
        },
        {
          rules: [
            {
              important: false,
              name: {
                name: "top",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "size",
                  unit: "px",
                  value: 100,
                },
              ],
            },
            {
              important: false,
              name: {
                name: "left",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "size",
                  unit: "%",
                  value: 100,
                },
              ],
            },
          ],
          selectors: [
            100,
          ],
          type: "frame",
        },
      ],
      scope: "keyframes",
      type: "atrule",
    },
  ];
  assertEquals(parser(input), expectation);
});

Deno.test(`media`, () => {
  const input = `
    abbr {
      color: chocolate;
    }

    @media (hover: hover) {
      abbr:hover {
        color: limegreen;
        transition-duration: 1s;
      }
    }

    @media not all and (hover: hover) {
      abbr::after {
        content: ' (' attr(title) ')';
      }
    }
  `;
  const expectation = [
    {
      rules: [
        {
          important: false,
          name: {
            name: "color",
            type: "literal",
          },
          type: "rule",
          value: [
            "chocolate",
          ],
        },
      ],
      selectors: [
        [
          {
            name: "abbr",
            scope: "tag",
            type: "selector",
          },
        ],
      ],
      type: "ruleset",
    },
    {
      query: [
        {
          type: "media-feature",
          value: {
            name: "hover",
            type: "feature-name",
            value: [
              "hover",
            ],
          },
        },
      ],
      ruleset: [
        {
          rules: [
            {
              important: false,
              name: {
                name: "color",
                type: "literal",
              },
              type: "rule",
              value: [
                "limegreen",
              ],
            },
            {
              important: false,
              name: {
                name: "transition-duration",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "time",
                  unit: "s",
                  value: 1,
                },
              ],
            },
          ],
          selectors: [
            [
              {
                name: "abbr",
                scope: "tag",
                type: "selector",
              },
              {
                double: false,
                name: "hover",
                scope: "pseudo",
                type: "selector",
                value: undefined,
              },
            ],
          ],
          type: "ruleset",
        },
      ],
      scope: "media",
      type: "atrule",
    },
    {
      query: [
        {
          condition: {
            scope: "and",
            type: "media-query-condition",
            value: {
              type: "media-feature",
              value: {
                name: "hover",
                type: "feature-name",
                value: [
                  "hover",
                ],
              },
            },
          },
          media_type: "all",
          scope: "not",
          type: "media-query",
        },
      ],
      ruleset: [
        {
          rules: [
            {
              important: false,
              name: {
                name: "content",
                type: "literal",
              },
              type: "rule",
              value: [
                {
                  type: "text",
                  value: " (",
                },
                {
                  name: "attr",
                  type: "fn",
                  value: [
                    [
                      "title",
                    ],
                  ],
                },
                {
                  type: "text",
                  value: ")",
                },
              ],
            },
          ],
          selectors: [
            [
              {
                name: "abbr",
                scope: "tag",
                type: "selector",
              },
              {
                double: true,
                name: "after",
                scope: "pseudo",
                type: "selector",
                value: undefined,
              },
            ],
          ],
          type: "ruleset",
        },
      ],
      scope: "media",
      type: "atrule",
    },
  ];
  assertEquals(parser(input), expectation);
});

Deno.test("comments, escaped strings, modern values, nesting, and generic at-rules", () => {
  const input = `
    /* leading comment */
    @charset "UTF-8";
    @import url("theme.css") layer(base);

    @font-face {
      font-family: "A\\\"B";
      src: url(font.woff2) format("woff2");
    }

    @supports selector(:has(> img)) and (display: grid) {
      .card:not(:is(.disabled, [aria-hidden="true"])) {
        color: #11223344;
        background:
          linear-gradient(45deg, rgb(0 0 0 / 50%), transparent),
          url("hero image.svg");
        width: calc(100% - 2rem);

        & > .title {
          margin: 1rem 2ch;
        }
      }
    }
  `;

  const result = parser(input);
  assertEquals(result[0], {
    type: "atrule",
    scope: "charset",
    prelude: `"UTF-8"`,
    ruleset: undefined,
  });
  assertEquals(result[1], {
    type: "atrule",
    scope: "import",
    prelude: `url("theme.css") layer(base)`,
    ruleset: undefined,
  });
  assertEquals(result[2].ruleset[0].value, [{
    type: "text",
    value: `A"B`,
  }]);
  assertEquals(result[2].ruleset[1].value, [
    { type: "url", value: "font.woff2" },
    {
      type: "fn",
      name: "format",
      value: [[{ type: "text", value: "woff2" }]],
    },
  ]);

  const supports = result[3];
  assertEquals(
    supports.prelude,
    "selector(:has(> img)) and (display: grid)",
  );
  const card = supports.ruleset[0];
  assertEquals(
    card.selectors[0][1].value,
    `:is(.disabled, [aria-hidden="true"])`,
  );
  assertEquals(card.rules[0].value, ["#11223344"]);
  assertEquals(card.rules[1].value[1], ",");
  assertEquals(card.rules[1].value[2], {
    type: "url",
    value: "hero image.svg",
  });
  assertEquals(card.rules[2].value[0].value[0], [
    { type: "size", value: 100, unit: "%" },
    "-",
    { type: "size", value: 2, unit: "rem" },
  ]);
  assertEquals(card.rules[3].selectors[0].scope, "combinator");
  assertEquals(card.rules[3].selectors[0].value[0][0].scope, "nesting");
});

Deno.test("vendor keyframes and hex-like IDs", () => {
  const result = parser(`
    #-abc, #deadbeef, .constructor, #__proto__ {}
    @-webkit-keyframes pulse {
      0%, 100% { opacity: .5; }
    }
  `);

  assertEquals(result[0].selectors[0][0].name, "-abc");
  assertEquals(result[0].selectors[1][0].name, "deadbeef");
  assertEquals(result[0].selectors[2][0].name, "constructor");
  assertEquals(result[0].selectors[3][0].name, "__proto__");
  assertEquals(result[1].scope, "keyframes");
  assertEquals(result[1].name, "pulse");
});
