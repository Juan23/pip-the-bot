// Tests for renderText, the only way chat text reaches the pages' HTML.
import { expect, test } from "bun:test";
import { renderText } from "./api.js";

test("renderText escapes HTML, so chat text can't run as code", () => {
  expect(renderText(`<script>alert("x")</script>`)).toBe("<p>&#60;script&#62;alert(&#34;x&#34;)&#60;/script&#62;</p>");
  expect(renderText(`<img src=x onerror='alert(1)'> & more`)).toBe("<p>&#60;img src=x onerror=&#39;alert(1)&#39;&#62; &#38; more</p>");
  // markup inside bold, code and list items stays text too
  expect(renderText("**<b onclick=x>hi</b>** `<iframe>`")).toBe("<p><strong>&#60;b onclick=x&#62;hi&#60;/b&#62;</strong> <code>&#60;iframe&#62;</code></p>");
  expect(renderText("- <svg onload=alert(1)>")).toBe("<ul><li>&#60;svg onload=alert(1)&#62;</li></ul>");
  // already-escaped text isn't decoded back into markup
  expect(renderText("&lt;script&gt;")).toBe("<p>&#38;lt;script&#38;gt;</p>");
  // Markdown links aren't supported, so no javascript: URL can become one
  expect(renderText("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
});

test("renderText renders bold, code, lists and paragraphs", () => {
  expect(renderText("  **Done**: ran `bun test`.  ")).toBe("<p><strong>Done</strong>: ran <code>bun test</code>.</p>");
  expect(renderText("Two things:\n\n- fix **login**\n* add `tests`\n\nThat's it.\nBye"))
    .toBe("<p>Two things:</p><ul><li>fix <strong>login</strong></li><li>add <code>tests</code></li></ul><p>That&#39;s it.<br>Bye</p>");
  // a block with any non-list line stays a paragraph
  expect(renderText("- one\nnot a list")).toBe("<p>- one<br>not a list</p>");
});
