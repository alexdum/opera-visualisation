
--- Guide for css-layout ---
# CSS Layouts and Responsive Design

1. [1 Fundamentals](#1-fundamentals)
   1. [Which layout mode to use?](#11-which-layout-mode-to-use)
   2. [Working principles](#12-working-principles)
2. [2 Flexbox](#2-flexbox)
3. [3 Grid and subgrid](#3-grid-and-subgrid)
   1. [Code example: grid and subgrid](#31-code-example-grid-and-subgrid)
4. [4 Container queries](#4-container-queries)
   1. [Code example: fluid typography using container query units](#41-code-example-fluid-typography-using-container-query-units)
5. [5 Native overlays, anchor positioning, and stacking contexts](#5-native-overlays-anchor-positioning-and-stacking-contexts)
6. [6 Overflow tracking and layout stability](#6-overflow-tracking-and-layout-stability)
7. [7 Viewport mechanics and track distribution](#7-viewport-mechanics-and-track-distribution)
8. [8 Grid lanes (aka masonry)](#8-grid-lanes-aka-masonry)

## 1 Fundamentals

Lean on the browser's layout engine when possible for better performance. Reach for intrinsic sizing, logical properties, and `aspect-ratio` before resorting to hardcoded dimensions or complicated media-queries.

### 1.1 Which layout mode to use?

Walk the decision tree top-to-bottom and stop at the first match. Note that layouts can be nested within each-other and each decision is based on the use-case for that container.

1. **Is it a simple row OR column of items?** Use **flexbox** — 1D, content-first, content distributes along a single axis.
2. **Does a nested element need to line up with its grandparent grid's tracks?** Use **subgrid** — 2D, relationship-first, inherits parent tracks so grandchildren can align across siblings.
3. **Is it a complex page or component structure with rows AND columns?** Use **grid** — 2D, layout-first, you define the skeleton and content fills it.
4. **Is the content a long flow of prose that should split into balanced columns?** Use **multi-column** — 1D flow, newspaper-style.
5. **Are items of varied heights that need to be packed tightly?** Use **grid** with `grid-auto-flow: dense` today; reach for native masonry (aka "grid lanes") only when it ships in your Baseline target (see [§8](#8-grid-lanes-aka-masonry)).
6. **Does an element need to float above the page and stay spatially tethered to a trigger, even across DOM boundaries or stacking contexts?** Use **anchor positioning** — `anchor-name` on the trigger, `position-anchor` on the overlay (see [§5](#5-native-overlays-anchor-positioning-and-stacking-contexts)).

### 1.2 Working principles

**Do:**

- Use logical properties (`inline-size`, `block-size`, `margin-inline`, `padding-block`, `inset-inline-start`) for layout dimensions and spacing — see `css` (via `npx -y modern-web-guidance@latest retrieve "css"`) for full coverage.
- Apply the content-first vs layout-first mental model: flexbox when items dictate flow, grid when you define the skeleton first.
- Use the `place-*` shorthands (`place-content`, `place-items`, `place-self`) to align across both axes in one declaration.
- Reach for intrinsic sizing (`min-content`, `max-content`, `fit-content()`) and flexible tracks (`fr`, `minmax()`) before fixed `width`/`height` — fewer media queries, more resilient layouts.
- Use `aspect-ratio` to reserve space for media and prevent layout shift before assets load.

```css
.sidebar       { inline-size: max-content; }    /* Size to longest unbreakable token. */
.main-content  { inline-size: fit-content; }    /* Grow to available space, no further. */
.media         { aspect-ratio: 16 / 9; inline-size: 100%; block-size: auto; }
body.centered  { display: grid; place-content: center; min-block-size: 100dvb; }
```

> For `calc-size()` and constraint-aware intrinsic sizing, see `calculate-with-intrinsic-sizes` (via `npx -y modern-web-guidance@latest retrieve "calculate-with-intrinsic-sizes"`).

## 2 Flexbox

One-dimensional layout — items flow along a single **main** axis with alignment on the **cross** axis. Reach for it for navbars, toolbars, item rows, and any single-row-or-column distribution.

**Do:**

- Establish a context with `display: flex` and set the main axis with `flex-direction` (`row` default).
- Use `flex-wrap: wrap` whenever overflow is a possibility — `nowrap` without `overflow: auto/hidden` will spill on narrow viewports.
- Use the `flex` shorthand `<grow> <shrink> <basis>` (e.g., `flex: 1 1 250px`) on items rather than setting `flex-grow`/`flex-shrink`/`flex-basis` individually.
- Use `gap` (or the `row-gap`/`column-gap` longhand) for spacing between items instead of child margins.
- Prefix positional alignment with `safe` (e.g., `align-items: safe center`) so focusable content isn't clipped when the container is narrower than its content.
- Push a single item to the far end of the main axis with `margin-inline-start: auto` (or `margin-block-start: auto`) — that's the standard escape hatch.
- Override cross-axis alignment per item with `align-self`.
- Use `align-items` to center all items on the cross axis; use `margin: auto` on a single item to center it on both axes independently; use `align-content` only when the container wraps and has extra space across rows.
- Set `min-inline-size: 0` (or `min-width: 0`) on flex items that contain long unbreakable content (URLs, code, long strings) — flex items won't shrink below their content size by default, causing overflow.

**Do not:**

- Don't reach for `justify-self` on flex items — it only works on grid, block, and absolutely-positioned layouts. Use auto margins instead.
- Don't use `order` or `flex-direction: *-reverse` to reorder interactive content. They change visual order only; the DOM order still drives sequential focus, so keyboard tab flow won't match what the user sees.
- Don't confuse `space-around` (half-gap at the ends) with `space-evenly` (equal gaps before, between, and after).
- Don't forget the axis flip: when `flex-direction: column`, `justify-content` aligns on the block axis and `align-items` aligns on the inline axis — the opposite of the default.
- Don't size both the container and its children to fill each other — that's a common source of overflow and surprising results. Give one side a definite size.
- Don't set both `flex-basis` and `width`/`inline-size` on the same item — `flex-basis` takes precedence in a flex context and `width` is ignored. Use `flex-basis` (or the `flex` shorthand) as the single source of truth for sizing flex items.

```css
.card-grid        { display: flex; flex-flow: row wrap; gap: 1rem; }
.card-item        { flex: 1 1 250px; }                  /* grow, shrink, basis */
.card-item-action { margin-inline-start: auto; }        /* Push to main-axis end. */
.toolbar          { display: flex; align-items: safe center; }
```

## 3 Grid and subgrid

Baseline status for Subgrid: Widely available. It's been Baseline since 2023-09-15.
Supported by: Chrome 117 (Sep 2023), Edge 117 (Sep 2023), Firefox 71 (Dec 2019), and Safari 16 (Sep 2022).

Two-dimensional layout — define rows AND columns explicitly, or let the engine derive them. Subgrid lets a nested grid inherit its parent's tracks so grandchildren align across siblings.

**Choosing grid features:**

- Do you know exactly how many columns you need?
  - **Yes** — use explicit tracks (`grid-template-columns: 200px 1fr`, `repeat(3, 1fr)`, etc.)
    - Do different columns need different sizes (sidebar + main, header spanning all)? → use `grid-template-areas` for named, readable regions
    - Are all columns uniform or positioned purely by line number? → use `repeat(N, ...)` or named lines
  - **No** (responsive, unknown item count) — use `repeat(auto-fit, minmax(min, 1fr))`
    - Should items on the last row stretch to fill remaining space? → `auto-fit`
    - Should empty last-row tracks hold their min size (preserving column ghost slots)? → `auto-fill`
- Do you need to place an item at a specific location?
  - **Yes** — use `grid-column: <start> / <end>` or `grid-area: <name>`
  - **No** (just spanning multiple tracks, flow position doesn't matter) — use `grid-column: span <n>`
- Do child elements need to inherit the parent grid's track sizes (ragged-edge alignment across siblings)?
  - **Yes** — use subgrid on the affected axis
    - Is the number of children per cell variable? → subgrid **one axis only**; use `grid-auto-rows`/`grid-auto-columns` for the other
    - Is the child count fixed? → subgrid on both axes is fine
  - **No** — standard grid, no subgrid needed

**Do:**

- Establish a context with `display: grid`.
- Use `grid-template-areas` for complex page-level layouts — area names are self-documenting and the declaration can be aligned in rows and columns for at-a-glance readability.
- Use `repeat(auto-fit, minmax(200px, 1fr))` for responsive card grids that stretch filled tracks to fill the row, or `auto-fill` to preserve empty repeated tracks at their min size.
- Use `fr` for proportional track distribution and `minmax(min, max)` for flexible-but-bounded tracks.
- Position items with `grid-column: span <n>` to size across tracks, `grid-column: <start> / <end>` to place at specific lines, or `grid-area: <name>` for named regions.
- Use subgrid (`grid-template-columns: subgrid` or `grid-template-rows: subgrid`) to solve the "ragged edge" problem in card lists — internal elements like titles, metadata, and CTAs line up across siblings.
- Pair a subgrid declaration with a preceding explicit `grid-template-rows`/`-columns` declaration as a same-cascade fallback for older browsers.

**Do not:**

- Don't expect `auto-fit`/`auto-fill` track size to come from item content — it comes from the `repeat()` size argument.
- Don't use `grid-auto-flow: dense` on interactive content. It packs items efficiently but reorders them visually, breaking DOM-order keyboard tab flow.
- Don't apply subgrid to both axes when the child count is variable. Extras land in the last track; use `grid-auto-rows`/`grid-auto-columns` for the implicit axis instead.
- Don't confuse `justify-items`/`align-items` (aligns item content *within its track*) with `justify-content`/`align-content` (aligns the grid tracks *within the container*). Using the wrong one silently has no effect.
- Don't use `repeat(auto-fit/auto-fill, ...)` without a definite `inline-size` on the container — inside `display: inline-grid` or an unsized flex item, the container has no width to divide, making track counts unpredictable.

### 3.1 Code example: grid and subgrid

Page shell: `<main class="page-layout">` contains `<header>`, `<aside>`, a `<section class="card-grid">` with `<div class="card">` children, and `<footer>`.

```css
/* Align grid-template-areas in rows and columns for readability. */
.page-layout {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-areas:
    "header  header  header"
    "sidebar main    main"
    "footer  footer  footer";
  gap: 1.5rem;
}

header  { grid-area: header; }
aside   { grid-area: sidebar; }
footer  { grid-area: footer; }

.card-grid {
  grid-area: main;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  grid-template-rows: auto 1fr; /* title block, body block */
  gap: 1rem;
}

.card {
  grid-row: span 2;
  display: grid;
  /* Same-cascade fallback: ignored when subgrid is supported. */
  grid-template-rows: auto 1fr;
  grid-template-rows: subgrid;
}
```

## 4 Container queries

Baseline status for Container queries: Widely available. It's been Baseline since 2023-02-14.
Supported by: Chrome 105 (Sep 2022), Edge 105 (Sep 2022), Firefox 110 (Feb 2023), and Safari 16 (Sep 2022).

Query the size (or computed style) of an ancestor container rather than the viewport. Mental model: container queries = component context; media queries = global page layout and user preferences (`prefers-color-scheme`, `prefers-reduced-motion`).

**Do:**

- Establish a containment context with `container-type: inline-size` (width-only queries) or `container-type: size` (both axes) on a wrapper before its descendants can be queried.
- Name containers with `container-name` (or the `container` shorthand: `container: inline-size card`) when nested contexts could collide.
- Include container query units in calculating fluid type and spacing: `cqi`/`cqb` (logical inline/block), `cqw`/`cqh` (physical), `cqmin`/`cqmax`.
- Give the container a definite `block-size` whenever `container-type: size` is used — without one, descendants collapse because size containment forces the container to ignore its content.

**Do not:**

- Don't use `block-size` as a `container-type` value — it isn't valid. Use `size` for both axes.
- Don't expect children's intrinsic size to influence the container after declaring `container-type`. The container is computed as if it has no children once containment is active.
- Don't rely on container query units inside descendants of a non-qualifying ancestor; they fall back to the small viewport (`svw`/`svh`).

### 4.1 Code example: fluid typography using container query units

```css
.card-wrapper {
  container: inline-size / card; /* shorthand for container-type + container-name */
}

@container card (inline-size > 400px) {
  .content {
    display: flex;
    gap: 2rem;
  }
}

.title {
  /* Fluid type bound to the container width, not the viewport. */
  font-size: clamp(1rem, 4cqi, 2rem);
}
```

> For component-driven responsive styling patterns, see `size-aware-styling` (via `npx -y modern-web-guidance@latest retrieve "size-aware-styling"`) and `fluid-scaling` (via `npx -y modern-web-guidance@latest retrieve "fluid-scaling"`).

## 5 Native overlays, anchor positioning, and stacking contexts

Baseline status for <dialog>: Widely available. It's been Baseline since 2022-03-14.
Supported by: Chrome 37 (Aug 2014), Edge 79 (Jan 2020), Firefox 98 (Mar 2022), and Safari 15.4 (Mar 2022).
Baseline status for Popover: Newly available. It's been Baseline since 2025-01-27.
Supported by: Chrome 116 (Aug 2023), Edge 116 (Aug 2023), Firefox 125 (Apr 2024), Safari 17 (Sep 2023), and Safari iOS 18.3 (Jan 2025).
Anchor positioning is not natively supported by any major browser yet.

**When to use each overlay primitive:**

- Use `popover` for transient, non-modal UI (flyouts, toasts, tooltips) — lives in the top layer, no `z-index` management needed.
- Use `<dialog>` with `.showModal()` for modal interactions that require focus trapping and an inert backdrop.
- Don't combine `popover` and `.showModal()` on the same element — they're mutually exclusive runtime states.

**Anchor positioning (spatial layout of overlays):**

- Use `position-area` (or `anchor()` on insets) and `anchor-size()` to position and size an overlay relative to its trigger.
- Use `position-try-fallbacks: flip-block` (or `flip-inline`) to let the browser reposition when the overlay overflows the viewport.
- Don't mix physical and logical keywords in a single `position-area` value — pick one coordinate system.
- Feature-detect with `@supports (anchor-name: --x)` and provide an absolute-position fallback.

> For full implementation detail, polyfill strategies, and `popover` value reference, see `declarative-dialog-popover-control` (via `npx -y modern-web-guidance@latest retrieve "declarative-dialog-popover-control"`) and `position-aware-tooltips` (via `npx -y modern-web-guidance@latest retrieve "position-aware-tooltips"`). For anchor positioning applied to menus and tab indicators, see `resilient-context-menus-and-nested-dropdowns` (via `npx -y modern-web-guidance@latest retrieve "resilient-context-menus-and-nested-dropdowns"`) and `anchor-positioning-tab-underline` (via `npx -y modern-web-guidance@latest retrieve "anchor-positioning-tab-underline"`).

## 6 Overflow tracking and layout stability

Baseline status for scrollbar-gutter: Newly available. It's been Baseline since 2024-12-11.
Supported by: Chrome 94 (Sep 2021), Edge 94 (Sep 2021), Firefox 97 (Feb 2022), and Safari 18.2 (Dec 2024).
line-clamp is not natively supported by any major browser yet.

Manage layout shifts, scrollbars, and clipping predictably.

**Do:**

- Use `overflow: auto` so scrollbars appear only when content actually overflows.
- Use `overflow: clip` to clip content **without** establishing a scroll container; opt into spillover with `overflow-clip-margin`.
- Use `scrollbar-gutter: stable` to reserve space for scrollbars and prevent layout shifts when content grows.
- Use `overscroll-behavior: contain` (or `none`) on scrollable containers to stop scroll chains from bubbling into the parent or document.
- Use the `-webkit-line-clamp` + `display: -webkit-box` + `-webkit-box-orient: vertical` triad for multi-line truncation — despite the prefix, this pattern is fully specified and not deprecated. Declare the unprefixed `line-clamp` shorthand alongside it; browsers that don't yet support it ignore the property harmlessly.
**Do not:**

- Don't use `overflow: scroll` when `auto` will do — `scroll` forces scrollbars even when there's nothing to scroll.
- Don't reach for `overflow: hidden` when you only want to clip — `hidden` establishes a scroll container that can be programmatically scrolled.

```css
.scrollable-list {
  max-block-size: 400px;
  overflow-y: auto;
  scrollbar-gutter: stable;       /* Reserve scrollbar space. */
  overscroll-behavior: contain;   /* No scroll chaining into the page. */
}

.snippet {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  line-clamp: 3;                  /* Ignored where unsupported. */
  overflow: clip;
}
```

> For `overflow: clip` and `overflow-clip-margin` in depth, see `overflow-clipping-control` (via `npx -y modern-web-guidance@latest retrieve "overflow-clipping-control"`). For scrollbar color, sizing, and theming, see `customize-scrollbar-color-and-thickness` (via `npx -y modern-web-guidance@latest retrieve "customize-scrollbar-color-and-thickness"`), `dark-mode` (via `npx -y modern-web-guidance@latest retrieve "dark-mode"`), and `adapt-scrollbar-to-contrast-preferences` (via `npx -y modern-web-guidance@latest retrieve "adapt-scrollbar-to-contrast-preferences"`).

## 7 Viewport mechanics and track distribution

Baseline status for Small, large, and dynamic viewport units: Widely available. It's been Baseline since 2022-12-05.
Supported by: Chrome 108 (Nov 2022), Edge 108 (Dec 2022), Firefox 101 (May 2022), and Safari 15.4 (Mar 2022).

- Use `dvh`/`dvw` for mobile layout containers that must account for browser UI shifting (URL bar collapse/expand).
- Don't use `100vw` for full-width layout — it ignores scrollbar width and causes horizontal overflow. Use `100%`, `100dvw`, or `100svw` instead.

> For the full viewport unit reference (`svh`, `lvh`, `dvi`, `dvb`, etc.), see `css` (via `npx -y modern-web-guidance@latest retrieve "css"`).

## 8 Grid lanes (aka masonry)

Masonry is not natively supported by any major browser yet.

The spec is in development. The currently agreed-upon name is "grid lanes" (e.g., `display: grid-lanes`). Firefox ships `grid-template-rows: masonry` behind a flag; no other engines ship it in stable as of this writing.

**Do:**

- Use grid with `grid-auto-flow: dense` for tight packing today, accepting that DOM order may not match visual order.
- Use multi-column (`columns: 3; column-gap: 1rem`) for content-heavy masonry-like flow when items are document fragments rather than equal-weight cards.
- Treat `grid-template-rows: masonry` as a progressive enhancement only — feature-detect with `@supports`.

**Do not:**

- Don't ship `grid-template-rows: masonry` as a hard requirement until your Baseline target catches up.

```css
.gallery       { columns: 3 200px; column-gap: 1rem; }
.gallery > *   { break-inside: avoid; margin-block-end: 1rem; }

@supports (grid-template-rows: masonry) {
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    grid-template-rows: masonry;
    gap: 1rem;
    columns: unset;
  }
}
```


--- Guide for accessibility ---
# Accessibility Coding Guidelines

This guide provides actionable DOs and DON'Ts for AI coding agents to ensure web applications are accessible to all users, including those using assistive technologies.

Keep these principles in mind throughout:

- **Accessibility is the minimum, not the ceiling.** Conformance to standards is the floor; aim for genuine usability.
- **Patterns are use-case specific.** No checklist replaces real testing — including testing with disabled users — to confirm a given implementation is actually accessible in context.

## 1. Content Navigability and Structure

### Actionable Guidelines

#### DOs
- **Place all content within landmarks**: Wrap the page in `<header>`, `<nav>`, `<main>`, `<aside>`, and `<footer>` so assistive-tech users can jump between regions.
- **Structure main content with headings**: Use `<h1>`–`<h6>` sequentially (no jumping `<h1>` → `<h4>`) so screen-reader users get a navigable outline.
- **Use lists for repeated, contiguous content**: `<ul>`/`<ol>` give assistive tech a count up front and let users skip the entire group.
- **Provide skip links** prior to repeated content like site headers with navigation or long/infinite lists, so that keyboard users can easily bypass them. Make sure the target is focusable (e.g. `<main id="content" tabindex="-1">`).
- **Semantic Tables**: Use `<caption>` and `<th scope="col">` (or `<th scope="row">`) for data tables.

#### DON'Ts
- **Don't use fake headings**: Never style `<div>` or `<span>` to look like headings without standard `<h1>`–`<h6>` tags.
- **Don't place headings inside `<summary>`, and avoid relying on headings inside `<details>` content**: Headings inside `<summary>` may be hidden from screen-reader heading lists and heading-navigation shortcuts entirely; headings inside `<details>` content are only reachable via heading navigation when the disclosure is open.
  - **Caveat**: If a heading must act as a disclosure trigger, use a more robust alternative to `<details>`/`<summary>` instead, e.g. an accordion or a disclosure implemented with ARIA where the heading wraps the button.
- **Don't use tables for layout**: Use CSS Grid/Flexbox for visual layouts.
- **Don't overuse landmarks**: Too many landmarks dilute their value. In particular, avoid labeling a `<section>` (which turns it into a `region` landmark) — `region` should be a last resort when no other landmark fits.

### Code Examples

```html
<!-- Good: Semantic landmarks, heading hierarchy, skip link -->
<header>
  <a href="#content" class="skip-link visually-hidden">Skip to content</a>
  <nav aria-label="Primary">
    <ul>
      <li><a href="/">Home</a></li>
    </ul>
  </nav>
</header>
<main id="content" tabindex="-1">
  <h1>Platform Dashboard</h1>
  <section>
    <h2>User Statistics</h2>
    <table>
      <caption>Monthly active users</caption>
      <tr>
        <th scope="col">Month</th>
        <th scope="col">Users</th>
      </tr>
      <tr>
        <td>January</td>
        <td>12,000</td>
      </tr>
    </table>
  </section>
</main>
```

## 2. Semantic HTML and ARIA

### Actionable Guidelines

#### DOs
- **Prefer HTML elements and attributes to ARIA**: A native element comes with the right role and behavior. `<button>` already implies `role="button"`; `required` already implies `aria-required`.
- **Match ARIA implementations to actual behavior**: If you set `role="tab"`, the element must behave like a tab — including keyboard interactions. Many ARIA patterns can't be implemented in CSS alone and need JavaScript.
- **Be deliberate about `disabled` vs `aria-disabled`**: `disabled` removes the element from the focus order entirely (and `tabindex="0"` won't bring it back), which is often wrong for toolbar buttons or links. `aria-disabled="true"` keeps the element focusable so users can land on it and learn it's disabled.

#### DON'Ts
- **Don't use ARIA when native HTML exists**: Avoid `<div role="button">` or `<a role="button">` if `<button>` works.
- **Don't add redundant ARIA roles or properties**: Avoid `<ul role="list">`, `<nav role="navigation">`, or `<input required aria-required="true">`.
  - **Caveat**: Safari removes list semantics from `<ul>`/`<ol>` outside `<nav>` when `list-style: none` or `display: flex`/`grid` is applied. In that case `role="list"` is required to restore them.
- **Don't assume custom elements have no ARIA**: Custom elements can attach ARIA via `ElementInternals`, which some automated test tools can't see — so the absence of `role`/`aria-*` attributes in markup doesn't prove the element has no semantics. Verify with the browser's accessibility-tree inspector.

## 3. Accessible Names and Descriptions

Every interactive element and some landmarks need an accessible name, and many benefit from an accessible description. Names are short and identify the element; descriptions add context.

### Actionable Guidelines

#### DOs
- **Prefer native naming mechanisms**: `<label>` for form controls, `<caption>` for `<table>`, `<legend>` for `<fieldset>`, `<figcaption>` for `<figure>`.
- **Explicitly associate `<label>` with its control via `for`/`id`**, even when nesting the input inside the label — explicit association improves assistive-tech support.
- **Prefer `aria-labelledby` over `aria-label` when a visible label exists**: avoids duplication, improves maintainability, and translates better.
- **Prefer to reuse the same accessible name for hyperlinks that share an `href`.**
- **Use visually hidden text to disambiguate controls** that look identical visually but do different things (e.g. multiple "Edit" buttons in a list).

#### DON'Ts
- **Don't put `aria-label`/`aria-labelledby` on elements that shouldn't be named** — e.g. plain `<div>`, `<span>`, or custom elements without a role. Custom elements may have an implicit role set via `ElementInternals`, so the absence of a `role` attribute isn't conclusive.
- **Don't reuse an accessible name across controls with different effects in the same view** (close buttons for two different open dialogs are fine because only one is reachable at a time; multiple “Edit” buttons for different content is not).
- **Don't reuse an accessible name across hyperlinks pointing to different `href`s.**
- **Don't pack descriptions, error messages, or instructions into the label.**
- **Don't repeat state already exposed via ARIA** (`aria-expanded`, `aria-checked`, `aria-selected`, `aria-pressed`) inside the accessible name — it creates redundancy and ambiguity.
- **Don't include the role name in the label**: `<nav aria-label="Primary navigation">` reads as "Primary navigation navigation."
- **Don't use `title` or `placeholder` as a naming mechanism.**
- **Don't include interactive elements in an `aria-describedby` target** unless their text content reads sensibly as a description on its own (e.g. if a link’s text is the same as how it’s labelled elsewhere, it can be included within a description).

### Code Example: Visually Hidden Utility

A `.visually-hidden` utility lets you provide text for screen readers without rendering it visually. It's commonly used for skip links, additional context on icon-only buttons, and supplementary labels.

```css
/* Hides content visually but keeps it in the accessibility tree.
   :focus-within / :active opt elements out — useful for skip links and
   any focusable content wrapped in this class. */
.visually-hidden:where(:not(:focus-within, :active)) {
  position: absolute !important;
  clip-path: inset(50%) !important;
  overflow: hidden !important;
  width: 1px !important;
  height: 1px !important;
  margin: -1px !important;
  padding: 0 !important;
  border: 0 !important;
  white-space: nowrap !important;
}
```

When the hidden content is focusable (skip links, focus-receiving wrappers), the `:focus-within`/`:active` exception lets it become visible. Style the visible state per situation, e.g. a skip link to the main content typically wants fixed positioning at the top-left of the viewport so the rest of the page doesn't shift.

## 4. Document Metadata and Language

### Actionable Guidelines

#### DOs
- **Declare Visual Language**: Always set `<html lang="en">` (or appropriate code).
- **Unique Page Titles**: Front-load unique context in `<title>` (e.g., `Page Topic | Site Name`).
- **Inline Language Switches**: Use `lang="..."` for block quotes or text in different languages.
- **IFrame Titles**: Always provide a descriptive `title="..."` for `<iframe>` elements.
- **Update document title on Page Transitions in SPAs**: Shift focus to updated titles.

#### DON'Ts
- **Don't Disable iframe Scrolling**: Avoid `scrolling="no"` (deprecated) or `overflow: hidden` on iframes. Users who zoom in or enlarge text need to scroll to reach content that overflows.

### Code Examples

```html
<!-- Good: Distinct title and language declaration -->
<html lang="en">
<head>
  <title>Analytics Reports | Guidance Platform</title>
</head>
<body>
  <p>The motto is <span lang="la">"Carpe diem"</span>.</p>
  <iframe title="Interactive Sales Chart" src="/chart"></iframe>
</body>
</html>
```

## 5. Keyboard and Focus Management

### Actionable Guidelines

#### DOs
- **Logical Tab Order**: Ensure tab order matches visual layouts (top-to-bottom).
- **Visible Focus Indicators**: Always style `:focus-visible` states explicitly. If disabling defaults, provide overrides with sufficient contrast.
- **Custom Trigger Keyboards**: Attach Enter/Space handlers for custom simulated interactive elements. When implementing a custom keyboard handler for button-like elements, `Enter` should be a `keydown` handler and `Space` should be a `keyup` handler (matching native `<button>` behavior where `Enter` repeats and `Space` triggers on release).
- **Use `tabindex` deliberately**: Anything focusable — by keyboard or programmatically — should have an implicit or explicit ARIA role, so don't make every element focusable. When focus is needed, choose `tabindex="0"` to add the element to the tab order or `tabindex="-1"` to make it programmatically focusable only (e.g., a skip-link target).
- **Manage Toggle States**: Utilize `aria-expanded` and `aria-pressed` to communicate toggle states for custom controls.

#### DON'Ts
- **Don't disable outlines without replacements**: Avoid `outline: none` without styling alternatives.
- **Don't use Positive Tabindex values**: Never use `tabindex="1"` or greater.
- **Don't hide interactive elements from screen readers**: Avoid `aria-hidden="true"` or `role="presentation"` on elements that can receive focus.

### Code Examples

```css
/* Good: High contrast focus border */
:where(a:any-link, button):focus-visible {
  outline: 3px solid #ff0055;
  outline-offset: 3px;
}
```

```html
<!-- Good: Skip to main content -->
<a href="#content" class="skip-link">Skip to main content</a>
<main id="content" tabindex="-1">...</main>
```

```javascript
// Good: Keyboard handlers for complex custom widgets (e.g., Tree items, tabs).
// NOTE: This pattern applies ONLY to non-standard UI where no native HTML tag exists.
// Always prioritize native <button> or <input> elements for standard interactions.
// Elements MUST have the appropriate ARIA role (e.g., role="treeitem" or role="tab").
customWidget.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    toggleWidgetState();
  }
  if (e.key === ' ') {
    e.preventDefault(); // Prevent page scrolling on Spacebar keydown
  }
});

customWidget.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    toggleWidgetState();
  }
});

function toggleWidgetState() {
  // E.g., Manage toggle/expanded states for custom controls
  const isExpanded = customWidget.getAttribute('aria-expanded') === 'true';
  customWidget.setAttribute('aria-expanded', !isExpanded);
}
```

## 6. Alternate Text and Media

### Actionable Guidelines

#### DOs
- **Informative Visual Descriptions**: Describe the purpose of the image (e.g., "Search", not "Magnifying glass").
- **Empty Alt properties for decorative visuals**: Use `alt=""` to remove decorative images from the accessibility tree so they aren't announced.
- **Synchronous Captions for videos**: Supply WebVTT captions for video tracks.
- **Transcripts for audio**: Provide text transcripts for purely audio podcasts.
- **Informative View Descriptions for inline SVGs**: Apply `role="img"` and a nested `<title>` tag for informative visuals.
- **Decorative SVGs removal**: Apply `aria-hidden="true"` to remove decorative SVGs from reading flows.
- **Long descriptions for complex images**: Use `<figure>`/`<figcaption>` or `aria-describedby` for charts and infographics.
- **Provide data tables as alternatives**: Consider providing semantic data tables as accessible alternatives for charts and other complex data visualizations.

#### DON'Ts
- **Don't use clichéd prefixes**: Avoid "Image of..." or "Picture of...".
- **Don't use underscores in filenames**: Use dashes if the filename might be announced as fallback.

### Code Examples

```html
<!-- Decorative -->
<img src="divider.png" alt="">

<!-- Inline Decorative SVG (remove from tab flow) -->
<svg aria-hidden="true" viewBox="0 0 24 24">
  <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
</svg>

<!-- Informative (Functional) -->
<a href="/search">
  <img src="glass.png" alt="Search the platform">
</a>

<!-- Video with Captions tracks -->
<video controls>
  <source src="intro.mp4" type="video/mp4">
  <track src="caps.vtt" kind="captions" srclang="en" label="English">
</video>

<!-- Complex graph with figcaption -->
<figure>
  <img src="chart.png" alt="Sales growth graph 2024.">
  <figcaption>Sales grew 20% in Q3 due to new platform launch.</figcaption>
</figure>

<!-- Audio with expandable transcript details -->
<audio controls src="podcast.mp3" aria-details="podcast-transcript"></audio>
<details id="podcast-transcript">
  <summary>View Transcript</summary>
  <div class="transcript-content">
    Welcome to the show...
  </div>
</details>
```

### Content Visibility Decision Matrix

| Intent | Visual | Screen Reader | Focusable | Structural Pattern |
| :--- | :--- | :--- | :--- | :--- |
| **Visible to all** | Yes | Yes | Yes | Standard rendering |
| **Screen Reader only** | No | Yes | Yes (if interactive) | Visually hidden utility (e.g. `.visually-hidden`) |
| **Visual only** | Yes | No | No | `aria-hidden="true"` / `role="presentation"` |
| **Hidden for all** | No | No | No | `hidden` attribute / `display: none` |

**Heuristic Rule**: If an element can receive keyboard focus, it must not be hidden via `aria-hidden="true"`.

## 7. Forms and Input Controls

### Actionable Guidelines

#### DOs
- **Connect Labels Programmatically**: Use `<label for="id">` linked to `<input id="id">`.
- **Use Autocomplete**: Set valid standard `autocomplete` options (e.g., `"email"` or `"given-name"`) for user profiles.
- **Link hints to inputs via `aria-describedby`**: Associate help text with inputs, and place the hint above the input so autocomplete popovers don't cover it during editing.
- **Announce dynamic errors via live regions**: Use `aria-live` or shift focus to error lists.
- **Provide form validation constraints**: Use `required` (or `aria-required="true"` only when `required` isn't applicable) to signal mandatory inputs.

#### DON'Ts
- **Don't use placeholders as labels**: Placeholders are not persistent labels.
- **Don't trigger context shifts on focus changes**: Avoid auto-submitting forms or jumping pages on focus change events alone.

### Code Examples

```html
<!-- Good: Semantic forms with hints for passwords -->
<form>
  <label for="pwd">Password:</label>
  <span id="pwd-hint">Must contain at least 8 characters.</span>
  <input id="pwd" type="password" aria-describedby="pwd-hint" autocomplete="current-password" required>
</form>
```

## 8. Live Regions

Live regions let assistive tech announce content updates that aren't tied to navigation or focus changes. They're easy to misuse — too many regions, or noisy ones, quickly become spam for screen-reader users.

### Live Region Urgency Table

| Urgency | Visual Analogue | `aria-live` Value | Behavioral Impact | Example |
| :--- | :--- | :--- | :--- | :--- |
| **Critical** | Modal / Alert | `assertive` (or `role="alert"`) | Interrupts immediately, clears speech queue | Session timeout, API failure |
| **Standard**| Toast / Banner | `polite` | Announces at next graceful break | Search results, "Saved" status |
| **Passive**  | Silent text | `off` | Only if user navigates to it | Live character count |

**Heuristic Rule**: Use `assertive` only for critical, time-sensitive updates that require immediate attention or prevent safe continuation (e.g., data loss, session timeouts, or network drops).

### Actionable Guidelines

#### DOs
- **Centralize live regions for non-visible announcements**: A single `polite` region and a single `assertive` region per page (with whatever `aria-atomic` configuration you need) keeps announcements consistent and easier to maintain. Many frameworks ship their own announcer abstraction — use it.
- **Debounce frequently-changing regions**: If a region can update many times per second (e.g. a combobox's result count as the user types), debounce so users aren't spammed.
- **Delay slightly when other announcements may collide**: When the user is typing or focus is being managed, a small delay before announcing keeps live-region updates from overlapping other speech.

#### DON'Ts
- **Don't use live regions for interstitial states** like "Loading…" or "Updating…" unless they're meaningfully informative — they usually just create noise.
- **Don't add live-region updates to inert DOM**: When dialogs open or sections become `inert`, queued or debounced messages can end up unannounced — or announced from DOM the user can't reach. Coordinate live-region updates with dialog/inert state changes.

### Code Example

```html
<!-- Session Timeout Warning with controls -->
<div role="alert" class="timeout-warning">
  Your session will expire in 2 minutes. 
  <button type="button" onclick="extendSession()">Extend Session</button>
</div>
```

## 9. Color, Contrast, and Typography

### Actionable Guidelines

#### DOs
- **Minimum contrast standards**: Maintain 4.5:1 for normal text and 3:1 for large text or icons.
- **Ensure non-text contrast standards**: Maintain a minimum contrast ratio of 3:1 for user interface component boundaries and states.
  - This includes visual elements (borders, backgrounds, box-shadows, underlines) that form the boundary or indicate the presence of a UI component (e.g., input field borders).
  - This also includes visual elements indicating active states within a component (e.g., checkbox checkmarks or switch thumbs).
  - **Caveat**: Meeting 3:1 non-text contrast can challenge minimalistic designs. Soft gradients or subtle inset/outset shadows can soften visual boundaries while satisfying accessibility requirements.
- **Use multiple state indicators**: Do not denote success/errors ONLY with color. Use icons or text.
- **Relative font size units**: Use `rem` or `em` for font sizes instead of `px`.
- **Consistent or Start alignment**: Avoid `justify` alignment as it can be more difficult to read.
- **Avoid long lines of text**: Cap paragraph blocks to a maximum of 80 characters width.
- **Support user zoom preferences**: Allow users to resize text up to 200% without loss of content or functionality.
- **Support light and dark color schemes**: Honor `@media (prefers-color-scheme: dark)` and pair it with the `color-scheme` CSS property so form controls, scrollbars, and other UA-rendered surfaces match.
- **Use `prefers-contrast` only when warranted**: Reach for `@media (prefers-contrast: more)` when the design uses low-contrast accents (e.g., subtle borders, muted secondary text) that need to be reinforced; most sites that already meet baseline contrast won't need it.

#### DON'Ts
- **Don't use color alone to indicate the presence of a user interface component or its state**: Use iconography and/or shape to help differentiate.
- **Don't use Justified Text Alignment**: Avoid `text-align: justify`.
- **Don't use Ornate fonts**: Omit cursive typefaces for main reading content.
- **Don't rely on all-caps for emphasis**: Prefer bolding for visual emphasis, and use `<em>`/`<strong>` when the emphasis is semantic.
- **Limit emphasis overall**: Emphasis loses meaning when it's everywhere — apply it only where it changes how the content should be read.

### Code Examples

```css
/* Good: Relative sizing and line caps */
body {
  line-height: 1.5;
  text-align: start; /* Supports LTR and RTL */
}
article {
  max-width: 80ch; /* Caps line length to ~80 characters for readability */
}
```

```html
<!-- Good: Denotes state without colors alone -->
<div class="error-msg">
  <span aria-hidden="true">❌</span>
  <span>The password entered was invalid.</span>
</div>
```

```css
/* Dark Mode support variables */
:root {
  --bg-color: #ffffff;
  --text-color: #212529;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-color: #121212;
    --text-color: #f8f9fa;
  }
}
```

## 10. Motions and Preferences

### Actionable Guidelines

#### DOs
- **Support Reduced Motion media queries**: Support `@media (prefers-reduced-motion: reduce)` media queries.
- **Provide Pause mechanism**: Allow users to stop auto-running carousels banners or other persistent animations.
- **Default to static views**: Consider defaulting to static states and allowing users to opt-in to motion.

#### DON'Ts
- **Don't exceed flash limits (three per second)**: Never include rapid light-to-dark flashing. Such effects can cause seizures.

### Code Examples

```css
/* Good: Dampen spin states for reduced motion queries */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
    opacity: 0.5;
  }
}
```

## 11. Modals and Native Dialogs

Modern browsers provide native solutions for creating modal dialogs which avoid the need for focus traps, managing the accessibility of outside content, ensuring the content is on top, and dimming the background content — all of which can be error prone and require heavy JavaScript event tracking to maintain.

### Actionable Guidelines

#### DOs
- **Use the Native `<dialog>` Element**: Invoke the dialog using the `.showModal()` method to open it in a modal state. When in a modal state, the browser sets outside content as inert (i.e. the outside content is hidden from the accessibility tree and cannot be interacted with nor be focused).
- **Use the `inert` Attribute for Custom Overlays**: When `<dialog>` cannot be used (e.g., some non-modal overlays, framework constraints, or layouts where `<dialog>`'s top-layer/positioning behavior conflicts with the design), apply `inert` to outside content to ensure it cannot be interacted with by keyboard, pointer, or assistive technology. This requires structuring elements in such a way that the custom overlay is not a descendant of the element with `inert` set on it.

#### DON'Ts
- **Don't implement focus traps for native modal dialogs**: When a `<dialog>` element is opened in a modal state, browsers set outside content as inert which is sufficient for ensuring only the dialog’s content can be focused.

### Code Examples

**HTML & JS: Native `<dialog>` with standard close events**
```html
<!-- Dialog opens natively with showModal() and locks focus -->
<button id="open-btn">Open Dialog</button>

<dialog id="accessible-modal" aria-labelledby="title-id">
  <h2 id="title-id">Account Settings</h2>
  <p>Update your details here.</p>
  <button onclick="this.closest('dialog').close()">Close Dialog</button>
</dialog>

<script>
  document.getElementById('open-btn').addEventListener('click', () => {
    document.getElementById('accessible-modal').showModal();
  });
</script>
```

## 12. Testing Validations

### Actionable Guidelines

#### DOs
- **Run Automated checks via axe-core or Lighthouse audits**: Catch missing alt texts or low contrasts (e.g., via Lighthouse in Chrome DevTools MCP).
- **Validate Sequential Navigations using keyboards alone**: Using only keyboard shortcuts, such as Tab/Shift+Tab, arrow keys, Enter, Space, and Esc, confirm every interactive element is reachable and operable, and that focus never gets stuck.
- **Test on Screen Readers with calibrated browsers**: Rely on standard bindings (e.g., JAWS with Chrome, NVDA with Firefox, Narrator with Edge, VoiceOver with Safari on macOS and iOS, TalkBack with Chrome for Android).

#### DON'Ts
- **Don't rely purely on scores**: A 100% score does not guarantee real usability.

