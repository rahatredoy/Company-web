# Client E-Commerce Website — Complete UI/UX Design Specification

**File:** `client-website-design.md`  
**Project Type:** Multi-Tenant E-Commerce SaaS Storefront  
**Frontend:** Next.js + TypeScript + Tailwind CSS + shadcn/ui  
**Backend:** Fastify + TypeScript  
**ORM:** Drizzle ORM  
**Database:** PostgreSQL (Database-per-Tenant)  
**Storage:** Cloudflare R2 / S3-compatible object storage  
**Design System:** Dynamic Storefront Layout / Template System  
**Version:** 1.0

---

# 1. Purpose

This document defines the complete UI/UX design, page structure, layout behavior, responsive behavior, component system, storefront templates, color themes, and user flows for the **Client E-Commerce Website**.

This website is the customer-facing storefront used by the customers of each SaaS client.

Each client receives:

- A default storefront subdomain, such as `abc-fashion.company.com`
- Optional custom storefront domain, such as `abcfashion.com`
- A website controlled dynamically from the Client Admin Panel
- A dedicated PostgreSQL tenant database
- A selectable storefront layout/template
- A selectable storefront color theme

The storefront must be fully dynamic. Store owners should not need a developer to change:

- Homepage sections
- Banners
- Navigation
- Featured products
- Categories
- Brands
- Theme
- Colors
- Logo
- Footer
- Policy pages
- Contact details
- SEO settings
- Product arrangement
- Homepage section order

---

# 2. Core Design Principles

The storefront UI must follow these principles:

1. Mobile-first
2. Fast product discovery
3. Clear buying flow
4. Minimal checkout friction
5. Strong visual hierarchy
6. Admin-controlled content
7. Template-driven layouts
8. Theme-driven colors
9. Accessible interactions
10. SEO-friendly structure
11. Consistent UI across all templates
12. No arbitrary client-side custom JavaScript
13. Customer trust signals clearly visible
14. Responsive for mobile, tablet, laptop, desktop, and large screens

---

# 3. High-Level Storefront Architecture

```text
Customer
   ↓
Client Domain / Subdomain
   ↓
Next.js Storefront
   ↓
Hostname / Tenant Resolver
   ↓
Tenant Configuration
   ↓
Selected Storefront Template
   ↓
Selected Color Theme
   ↓
Commerce API
   ↓
Correct Tenant Database
```

Examples:

```text
abc-fashion.company.com
        ↓
Tenant A
        ↓
Template: fashion_boutique
Color: rose_pink
```

```text
techzone.com
        ↓
Tenant B
        ↓
Template: electronics
Color: midnight_navy
```

The same storefront codebase must render both stores.

---

# 4. Dynamic Storefront Template System

The website supports **6 storefront templates**.

These are layout systems, not completely separate applications.

| Display Name | Code Key | Best Use |
|---|---|---|
| Marketplace | `marketplace` | Large general stores / many categories |
| Modern Shop | `modern_shop` | General modern e-commerce |
| Fashion Boutique | `fashion_boutique` | Fashion, beauty, accessories |
| Minimal Store | `minimal_store` | Premium, clean, luxury brands |
| Electronics | `electronics` | Tech, gadgets, appliances |
| Lifestyle | `lifestyle` | Furniture, home, decor, lifestyle |

Example store setting:

```json
{
  "storefront_template": "fashion_boutique"
}
```

---

# 5. Storefront Color Theme System

The storefront supports **8 predefined color themes**.

| Display Name | Code Key | Primary | Secondary | Background |
|---|---|---|---|---|
| Royal Blue | `royal_blue` | `#2563EB` | `#1E40AF` | `#F8FAFC` |
| Emerald Green | `emerald_green` | `#059669` | `#065F46` | `#F7FCFA` |
| Luxury Black | `luxury_black` | `#18181B` | `#3F3F46` | `#FAFAFA` |
| Rose Pink | `rose_pink` | `#DB2777` | `#9D174D` | `#FFF7FA` |
| Modern Purple | `modern_purple` | `#7C3AED` | `#5B21B6` | `#FAF8FF` |
| Sunset Orange | `sunset_orange` | `#EA580C` | `#C2410C` | `#FFF9F5` |
| Midnight Navy | `midnight_navy` | `#172554` | `#0F172A` | `#F8FAFC` |
| Olive Premium | `olive_premium` | `#46563C` | `#293522` | `#F8F5ED` |

Example:

```json
{
  "color_theme": "rose_pink"
}
```

---

# 6. Design Token Architecture

Never hard-code theme colors inside individual components. Use CSS variables/design tokens.

```css
:root {
  --color-primary: #2563EB;
  --color-primary-hover: #1D4ED8;
  --color-secondary: #1E40AF;
  --color-accent: #60A5FA;

  --color-page: #F8FAFC;
  --color-surface: #FFFFFF;
  --color-surface-muted: #F1F5F9;

  --color-heading: #0F172A;
  --color-text: #334155;
  --color-text-muted: #64748B;

  --color-border: #E2E8F0;

  --color-success: #16A34A;
  --color-warning: #F59E0B;
  --color-danger: #DC2626;

  --radius-card: 12px;
  --radius-button: 8px;
}
```

Templates control:

- Grid behavior
- Hero structure
- Navigation style
- Product card style
- Category presentation
- Section spacing
- Banner style
- Typography pairing
- Image ratio
- Card border/radius behavior

Color themes control:

- Primary/secondary/accent colors
- Buttons
- Links
- Badges
- Focus rings
- Highlight backgrounds
- Section accents

---

# 7. Global Storefront Layout

Every template uses this basic information architecture:

```text
Announcement Bar
Header
Main Navigation
Optional Category Navigation
Main Content
Newsletter
Footer
```

Templates may visually combine or reposition these sections.

---

# 8. Announcement Bar

Used for:

- Free shipping
- Sales
- Coupons
- Limited-time campaigns
- Store notices

Example:

```text
Free shipping on orders over ৳2,000
```

Desktop:

- Full width
- 28–38px tall
- Centered message
- Optional navigation arrows for multiple notices

Mobile:

- Single concise line
- Truncate intelligently if needed

Admin controls:

- Enable/disable
- Text
- Link
- Schedule
- Priority
- Multiple messages

---

# 9. Desktop Header

Contains:

```text
Logo
Navigation
Search
Account
Wishlist
Cart
Optional Language
Optional Currency
```

Recommended structure:

```text
┌─────────────────────────────────────────────────────┐
│ Logo    Nav       Search       Account  ♡  Cart    │
└─────────────────────────────────────────────────────┘
```

Logo:

- Client-uploaded logo
- Fallback to store name text
- Desktop max width around 180px
- Mobile max width around 130px

Cart and wishlist show counters only when count > 0.

---

# 10. Mobile Header

Possible layout:

```text
☰    LOGO              Search   Cart
```

or:

```text
LOGO
Full-width Search
Menu / Category row
```

Mobile navigation opens as a drawer.

Drawer contains:

- Home
- Shop
- Categories
- Brands
- New Arrivals
- Best Sellers
- Sale
- Account
- Wishlist
- Help/policies
- Currency/language if enabled

---

# 11. Search Experience

Desktop search should support autocomplete.

Autocomplete can show:

- Product image
- Product name
- Price
- Category
- Brand
- Suggested query

Mobile search should use a large dedicated overlay or full-screen search panel.

Search Results page includes:

- Search query title
- Product count
- Filters
- Sorting
- Product grid
- Empty state

---

# 12. Main Navigation

Default menu:

```text
Home
Shop
Categories
Brands
New Arrivals
Best Sellers
Sale
About Us
Contact
```

Everything is configurable.

Admin may:

- Add/remove items
- Reorder
- Nest menus
- Link categories
- Link products
- Link custom pages
- Add safe custom URLs

Desktop: dropdown or mega-menu.  
Mobile: accordion navigation.

---

# 13. Mega Menu

Use for larger catalogs.

Example:

```text
Fashion
├── Women
│   ├── Dresses
│   ├── Tops
│   └── Shoes
├── Men
│   ├── Shirts
│   └── Shoes
└── Accessories
```

Mega menus may include:

- Category columns
- Promotional image
- Featured product
- Sale card

Marketplace/Electronics templates should use this more heavily than Minimal Store.

---

# 14. Homepage Section System

Homepage sections are dynamic and reorderable.

Available section types:

```text
hero
category_grid
category_circle
featured_products
new_arrivals
best_sellers
sale_products
flash_sale
promotional_banner
dual_banner
triple_banner
brand_carousel
featured_collection
product_carousel
frequently_bought
service_benefits
testimonial
lookbook
newsletter
custom_content
```

Each section contains:

```text
enabled
title
subtitle
position
layout
configuration
```

Example homepage order:

```text
1 Hero
2 Category Grid
3 Benefits
4 Featured Products
5 Sale Banner
6 New Arrivals
7 Brands
8 Newsletter
```

---

# 15. Homepage Hero

Contains:

- Campaign eyebrow
- Heading
- Description
- Primary CTA
- Secondary CTA
- Main visual
- Optional discount badge
- Optional slider controls

Example:

```text
NEW COLLECTION

Timeless Style
Modern You

Discover the latest collection.

[Shop Now] [Explore Collection]
```

Admin controls:

- Desktop image
- Mobile image
- Heading
- Subtitle
- CTAs
- Links
- Alignment
- Overlay
- Slider items
- Schedule

---

# 16. Hero Layout by Template

## Marketplace

- Left category sidebar
- Large promotional hero
- Strong discount/message visibility

## Modern Shop

- Rounded full-width hero
- Balanced text/image split
- Modern spacing

## Fashion Boutique

- Editorial photography
- Large typography
- Collection-focused

## Minimal Store

- Large photography
- Minimal text
- Lots of white space

## Electronics

- Product-driven hero
- High contrast
- Offer/spec badges

## Lifestyle

- Warm editorial imagery
- Collection storytelling
- Softer sales treatment

---

# 17. Category Section

Supported visual styles:

### Circle categories

```text
○ Women  ○ Men  ○ Shoes  ○ Beauty  ○ Electronics
```

### Rectangular category cards

Image + title overlay.

### Marketplace category grid

Many compact categories.

### Editorial collection cards

Large lifestyle visuals.

Admin controls:

- Category selection
- Image override
- Title
- Layout
- Count
- Desktop columns

Mobile: horizontal scroll or two-column grid depending on template.

---

# 18. Service Benefits

Default:

```text
Free Shipping
Easy Returns
Secure Payment
Customer Support
```

Each item:

- Icon
- Title
- Short description

Example:

```text
Free Shipping
On orders over ৳2,000
```

---

# 19. Promotional Banners

Support:

- Single full-width banner
- Dual banners
- Triple banners
- Campaign strip

Admin controls:

- Image
- Mobile image
- Heading
- Subtitle
- CTA
- URL
- Schedule
- Alignment
- Overlay

---

# 20. Product Card

Each card may show:

- Main image
- Secondary hover image
- Product name
- Price
- Original price
- Discount badge
- Rating
- Review count
- Wishlist
- Stock status
- New badge
- Sale badge
- Optional quick add
- Optional variant swatches

Example:

```text
[IMAGE]      ♡
-20%

Classic Leather Watch
৳8,490   ৳9,990
★★★★★ (215)
```

---

# 21. Product Card States

## Normal
Default state.

## Sale
Sale price + crossed original price + badge.

## Out of Stock
Show `Out of Stock`. Disable normal add-to-cart. Optionally show `Notify Me`.

## Low Stock
Optional message such as `Only a few left`.

## New
Show `New` badge.

---

# 22. Product Grid

Responsive recommendation:

- Large desktop: 5–6 columns
- Desktop: 4–5 columns
- Tablet: 3 columns
- Mobile: 2 columns

Templates may adjust proportions, but the experience must remain consistent.

---

# 23. Product Carousel

Used for:

- Featured Products
- New Arrivals
- Best Sellers
- Sale Products
- Related Products
- Recently Viewed

Desktop: arrows.  
Mobile: horizontal swipe.

Prefer lightweight/native scrolling where possible.

---

# 24. Product Tabs

Optional homepage block:

```text
Featured | New Arrivals | Best Sellers | On Sale
```

Switch without a full page navigation where possible.

---

# 25. Brand Section

Can use:

- Logo strip
- Logo grid
- Carousel

Click brand → Brand Page.

Admin chooses featured brands.

---

# 26. Newsletter

```text
Subscribe to our newsletter
Get updates on new products and offers.

[Email] [Subscribe]
```

States:

- Valid subscription
- Already subscribed
- Invalid email
- Server error

---

# 27. Footer

Desktop columns:

```text
Brand Information

Shop
├── All Products
├── New Arrivals
├── Best Sellers
└── Sale

Customer Service
├── Contact
├── Shipping
├── Returns
├── Track Order
└── FAQ

My Account
├── Orders
├── Wishlist
├── Account Details
└── Addresses

Company
├── About
├── Privacy
├── Terms
└── Return Policy
```

Also display:

- Payment methods
- Social links
- Currency/language if enabled
- Copyright

Mobile: accordion footer.

---

# 28. Breadcrumbs

All internal pages use breadcrumbs.

Example:

```text
Home / Electronics / Smartphones / Product Name
```

---

# 29. Shop / All Products Page

URL:

```text
/shop
```

Structure:

```text
Breadcrumb
Title
Optional Intro
Toolbar
Filters + Product Grid
Pagination / Load More
```

Desktop:

```text
[Filter Sidebar] [Product Grid................]
```

Mobile:

```text
[Filter] [Sort]
Product Grid
```

---

# 30. Listing Toolbar

Show:

- Product/result count
- Sort
- Mobile filter button

Sort options:

```text
Newest
Price: Low to High
Price: High to Low
Best Selling
Highest Rated
```

---

# 31. Filters

Possible groups:

- Category
- Subcategory
- Brand
- Price
- Rating
- Availability
- Color
- Size
- Model
- Material
- Product-specific attributes

Desktop: sidebar accordions.  
Mobile: drawer/bottom sheet.

Active chips example:

```text
Brand: Apple ×
Price: ৳20,000–৳50,000 ×
In Stock ×
```

Include `Clear All`.

---

# 32. Category Page

URL:

```text
/category/[slug]
```

Contains:

- Breadcrumb
- Category title
- Optional category hero
- Subcategories
- Description
- Product listing
- Filters
- Sorting

---

# 33. Subcategory Page

Same listing framework as Category Page with hierarchy context.

Example:

```text
Women → Dresses
```

---

# 34. Brand Page

URL:

```text
/brand/[slug]
```

Contains:

- Brand logo
- Name
- Description
- Product count
- Product grid
- Filters
- Sort

---

# 35. Search Results Page

URL:

```text
/search?q=iphone
```

Show:

```text
Search results for "iphone"
24 products found
```

No result state:

```text
No products found.
```

Then offer:

- Search again
- Suggested categories
- Popular products

---

# 36. Product Details Page

Desktop layout:

```text
┌───────────────────────┬──────────────────────────┐
│ Product Gallery       │ Product Name             │
│                       │ Rating                   │
│                       │ Price                    │
│                       │ Variants                 │
│                       │ Stock                    │
│                       │ Quantity                 │
│                       │ Add to Cart              │
│                       │ Buy Now                  │
│                       │ Wishlist                 │
└───────────────────────┴──────────────────────────┘
```

Below:

```text
Description
Specifications
Shipping
Returns
Reviews
Related Products
Frequently Bought Together
```

---

# 37. Product Gallery

Support:

- Main image
- Thumbnails
- Zoom
- Fullscreen
- Video
- Variant image
- Mobile swipe

Desktop: vertical or bottom thumbnails depending on template.

---

# 38. Product Information

Show:

- Brand
- Product name
- Rating
- Review count
- SKU
- Regular price
- Sale price
- Discount
- Stock
- Short description
- Variants
- Quantity
- Add to Cart
- Buy Now
- Wishlist

Optional:

- Delivery estimate
- Secure checkout trust line
- Share button

---

# 39. Variant Selector

Supported attributes:

```text
Color
Size
Model
Storage
RAM
Weight
Material
```

Color → swatches.  
Size → chips.  
Model → chips/dropdown depending on count.

Changing variant updates:

- Image
- SKU
- Price
- Sale price
- Availability
- Stock status

Unavailable combinations are disabled.

---

# 40. Quantity Selector

```text
[-] 1 [+]
```

Respect:

- Minimum order
- Maximum order
- Availability
- Per-product limits

---

# 41. Add to Cart

Clicking `Add to Cart` should:

1. Validate variant
2. Validate quantity
3. Add item
4. Update cart count
5. Show toast or mini-cart

Do not force navigation to Cart.

---

# 42. Buy Now

Flow:

```text
Validate Product/Variant
↓
Prepare Checkout Item
↓
Checkout
```

---

# 43. Frequently Bought Together

Example:

```text
☑ Phone
☑ Case
☑ Screen Protector

Total: ৳...
[Add Selected to Cart]
```

Backend calculates final pricing.

---

# 44. Related Products

Carousel based on:

- Category
- Brand
- Tags
- Explicit admin relation

---

# 45. Product Detail Tabs

Desktop:

```text
Description | Specifications | Shipping | Returns | Reviews
```

Mobile: accordion sections.

---

# 46. Reviews

Header example:

```text
4.8
★★★★★
215 Reviews
```

Rating distribution:

```text
5 ★ █████████ 80%
4 ★ ███       15%
3 ★ █          4%
2 ★            1%
1 ★            0%
```

Review card:

- Customer name/display name
- Rating
- Verified Purchase badge
- Date
- Text
- Images
- Admin reply if present

---

# 47. Write Review

Form:

- Rating
- Title
- Review
- Images if enabled

Backend determines verified purchase status.

---

# 48. Cart Page

URL:

```text
/cart
```

Desktop:

```text
Cart Items                 Order Summary
--------------------       -----------------
Image                      Subtotal
Product                    Discount
Variant                    Shipping Estimate
Price                      Tax
Quantity                   Total
Remove                     Checkout
```

Mobile: stacked cards.

---

# 49. Cart Item

Show:

- Product image
- Product name
- Variant
- Unit price
- Quantity selector
- Remove
- Move to wishlist if enabled

---

# 50. Cart Summary

Show:

```text
Subtotal
Discount
Estimated Shipping
Estimated Tax
Total
```

CTA:

```text
Proceed to Checkout
```

Final amounts are recalculated by backend at checkout.

---

# 51. Coupon

```text
Coupon code [________] [Apply]
```

States:

- Applied
- Invalid
- Expired
- Not applicable
- Usage limit reached
- Minimum purchase not reached

Applied:

```text
WELCOME10 ✓  Remove
```

---

# 52. Empty Cart

```text
Your cart is empty.
[Continue Shopping]
```

Optional featured/recent products below.

---

# 53. Checkout Page

Desktop:

```text
Customer / Shipping / Payment          Order Summary
```

Mobile: single column.

Recommended first release: one-page checkout with clearly divided sections.

---

# 54. Checkout Contact

Guest:

- Email
- Phone

Logged in:

- Pre-filled customer data

Show optional:

```text
Already have an account? Sign in
```

---

# 55. Shipping Address

Typical fields:

```text
Full Name
Phone
Address Line 1
Address Line 2
City
State / District
Postal Code
Country
```

Address structure may later be localized per country.

---

# 56. Saved Addresses

Logged-in customer can:

- Select
- Add
- Edit
- Save
- Set default

---

# 57. Shipping Method

Example:

```text
Standard Delivery
৳80
2–3 days

Express Delivery
৳150
Next day
```

Availability/pricing must come from backend.

---

# 58. Payment Methods

Possible methods:

```text
Cash on Delivery
bKash
Nagad
SSLCommerz
Stripe
PayPal
Bank Payment
```

Only enabled methods render.

---

# 59. Checkout Order Summary

Show:

- Product
- Variant
- Quantity
- Price
- Discount
- Shipping
- Tax
- Total

CTA:

```text
Place Order
```

Disable during processing to prevent double submission.

---

# 60. Checkout Success

URL example:

```text
/order/success/[orderNumber]
```

Show:

```text
Order Confirmed
Thank you for your purchase.

Order #ABC123
```

Also:

- Payment status
- Total
- Address
- Delivery estimate
- View order
- Continue shopping

---

# 61. Payment / Checkout Failure

Clearly differentiate payment failure from order creation failure.

Possible CTAs:

- Retry Payment
- Choose Another Method
- View Order
- Contact Support

---

# 62. Customer Authentication Pages

Pages:

```text
/login
/register
/forgot-password
/reset-password
/verify-email
```

Customer auth is separate from Client Admin auth.

---

# 63. Login Page

Layout varies by template:

- Centered card
- Split image + form

Fields:

```text
Email / Phone
Password
```

Actions:

```text
Login
Forgot Password
Create Account
```

---

# 64. Register Page

Fields:

```text
First Name
Last Name
Email
Phone if required
Password
Confirm Password
Terms Acceptance
```

Avoid unnecessary mandatory data.

---

# 65. Forgot Password

```text
Email
[Send Reset Link]
```

Use neutral success message regardless of account existence.

---

# 66. Customer Account Area

URL:

```text
/account
```

Desktop:

```text
Sidebar             Main Content
Dashboard
Orders
Addresses
Wishlist
Returns
Profile
Security
Logout
```

Mobile: dropdown/tabs/stacked navigation.

---

# 67. Account Dashboard

Show:

```text
Welcome, Customer
```

Quick cards:

- Active Orders
- Completed Orders
- Wishlist
- Default Address

Optional latest order/recently viewed.

---

# 68. My Orders

List columns/cards:

```text
Order #
Date
Total
Payment Status
Order Status
View
```

Filters:

- All
- Active
- Delivered
- Cancelled
- Returned
- Refunded

---

# 69. Order Details

Show:

- Order number
- Date
- Order status
- Payment status
- Products
- Shipping address
- Billing address
- Payment method
- Shipping method
- Totals
- Timeline
- Invoice
- Cancel/Return actions if allowed

---

# 70. Order Timeline

```text
✓ Order Placed
✓ Confirmed
✓ Processing
● Shipped
○ Delivered
```

Use timestamps when available.

---

# 71. Order Tracking

Show:

- Current status
- Courier
- Tracking number
- External tracking link when configured
- Timeline
- Estimated delivery

Never expose internal staff notes.

---

# 72. Invoice

Actions:

```text
View Invoice
Download Invoice
```

Invoice includes:

- Store info
- Customer info
- Order
- Items
- Discounts
- Tax
- Shipping
- Grand total
- Payment status

---

# 73. Order Cancellation

Only show if allowed.

Flow:

```text
Cancel Order
↓
Select/Enter Reason
↓
Confirm
```

Use a confirmation dialog.

---

# 74. Returns Page

URL:

```text
/account/returns
```

Show:

- Return number
- Order
- Item count
- Requested date
- Status
- Resolution
- Details

---

# 75. Return Request Flow

```text
Choose Order
↓
Choose Item(s)
↓
Quantity
↓
Reason
↓
Description
↓
Evidence
↓
Refund / Exchange / Replacement
↓
Review
↓
Submit
```

---

# 76. Return Evidence Upload

Support images and optional video if enabled.

UI:

- Drag/drop desktop
- Camera/gallery mobile
- Preview
- Remove
- File requirements

---

# 77. Return Status Page

Timeline:

```text
Requested
↓
Under Review
↓
Approved
↓
Product Received
↓
Inspection
↓
Refund / Exchange / Replacement
```

If rejected, show a customer-safe reason.

---

# 78. Wishlist

URL:

```text
/wishlist
```

Show:

- Product
- Current price
- Stock
- Remove
- Add to cart

Out of stock → `Notify Me` if enabled.

---

# 79. Compare Products

URL:

```text
/compare
```

Desktop comparison columns:

```text
Product A | Product B | Product C
```

Rows:

- Image
- Price
- Rating
- Brand
- Availability
- Attributes
- Specifications
- Add to Cart

Mobile: horizontal scroll.

---

# 80. Back-in-Stock

Out-of-stock page action:

```text
Notify Me
```

Logged-in customer → pre-fill email.  
Guest → ask for email/phone depending on configuration.

Success message:

```text
We'll notify you when this item is back in stock.
```

---

# 81. Contact Page

Contains:

- Business name
- Address
- Phone
- Email
- Hours
- Contact form
- WhatsApp
- Optional map
- Social links

Form:

```text
Name
Email
Phone
Subject
Message
```

---

# 82. About Us

Suggested layout:

```text
Hero / Title
Brand Story
Mission
Values
Images
Optional Statistics
CTA
```

Content controlled by Client Admin.

---

# 83. FAQ

Use accordion groups.

Categories may include:

```text
Orders
Payments
Shipping
Returns
Account
Products
```

---

# 84. Privacy Policy

Standard content page:

- Title
- Last updated
- Rich text
- Optional table of contents

---

# 85. Terms & Conditions

Same content structure as Privacy Policy.

---

# 86. Return Policy

Clearly show:

- Return window
- Eligible products
- Non-returnable products
- Required condition
- Process

---

# 87. Shipping Policy

Show:

- Delivery zones
- Charges
- Free shipping rules
- Expected delivery
- Courier information

---

# 88. 404 Page

```text
Page Not Found
The page you're looking for doesn't exist.

[Go Home] [Shop Products]
```

Optional recommendations below.

---

# 89. Generic Error Page

```text
Something went wrong.
Please try again.

[Retry] [Go Home]
```

Never show stack traces or database information.

---

# 90. Maintenance Page

```text
We'll be back soon.
```

May include:

- Logo
- Message
- Contact
- Social links

---

# 91. Suspended Storefront Page

Use neutral wording:

```text
This store is temporarily unavailable.
```

Do not publicly expose billing/security details.

---

# 92. Loading States

Use skeletons for:

- Product cards
- Product grids
- Search suggestions
- Order lists
- Account blocks

Buttons can show compact inline loading indicators.

---

# 93. Empty States

Examples:

```text
Your wishlist is empty.
```

```text
You haven't placed any orders yet.
```

```text
No products found.
```

Always provide a next action when possible.

---

# 94. Toasts

Use for:

- Added to cart
- Added to wishlist
- Removed from wishlist
- Coupon applied
- Address saved
- Review submitted

Use safe user-facing error text.

---

# 95. Dialog Rules

Use dialogs for:

- Destructive confirmations
- Remove actions
- Order cancellation
- Address deletion
- Return submission
- Logout-all-sessions

Avoid excessive modals.

---

# 96. Mobile Sticky Actions

Product page:

```text
৳12,990          [Add to Cart]
```

Checkout:

```text
Total ৳...        [Place Order]
```

Respect phone safe areas.

---

# 97. Sticky Header

Desktop: sticky nav after scroll if appropriate.  
Mobile: sticky header strongly recommended.

Keep height compact.

---

# 98. Responsive Breakpoints

Conceptually:

```text
Mobile: < 640px
Small Tablet: 640–767px
Tablet: 768–1023px
Desktop: 1024–1439px
Large: 1440px+
```

Do not design for fixed phone models.

---

# 99. Spacing System

Recommended increments:

```text
4
8
12
16
20
24
32
40
48
64
80
```

Section spacing:

- Desktop: 48–80px
- Mobile: 28–48px

Template-dependent.

---

# 100. Typography

## Marketplace
Modern sans serif.

## Modern Shop
Clean modern sans.

## Fashion Boutique
Elegant serif headings + sans body.

## Minimal Store
Premium serif or geometric sans.

## Electronics
Bold technical sans.

## Lifestyle
Editorial serif + understated sans.

Use performant font loading.

---

# 101. Button System

Variants:

```text
Primary
Secondary
Outline
Ghost
Danger
Icon
```

Primary:

```text
Shop Now
Add to Cart
Place Order
```

Secondary:

```text
Explore Collection
Continue Shopping
```

---

# 102. Badges

Use consistent badges:

```text
Sale
New
Best Seller
Out of Stock
Low Stock
Verified
Delivered
Cancelled
Refunded
```

Semantic statuses should retain meaningful status colors even if theme colors differ.

---

# 103. Forms

Every input needs:

- Label
- Input control
- Error message
- Optional help text
- Focus state
- Disabled state

Never rely on placeholder alone as a label.

---

# 104. Validation UX

Use friendly validation messages.

Example:

```text
Please enter a valid email address.
```

Do not expose internal schema messages.

---

# 105. Accessibility

Minimum requirements:

- Keyboard navigation
- Visible focus
- Semantic heading order
- Labelled forms
- Accessible dialogs/drawers
- Useful alt text
- Proper buttons/links
- Good contrast
- Do not use color alone for meaning
- Reduced motion consideration

---

# 106. Product Images

Use consistent ratios.

Recommended:

```text
Marketplace: 1:1
Electronics: 1:1
Fashion Boutique: 4:5
Minimal Store: 4:5 or editorial
Lifestyle: 1:1 or 4:5 depending category
```

Use optimized CDN images.

---

# 107. Product Video

Rules:

- Lazy load
- Poster image
- No autoplay with sound
- Standard controls
- Mobile performance friendly

---

# 108. SEO Design Requirements

Support:

- Page title
- Meta description
- Canonical URL
- Open Graph
- Product structured data
- Breadcrumb structured data
- Sitemap
- robots.txt
- SEO-friendly URLs
- Image alt text

---

# 109. Multi-Language

When enabled, show a language selector.

Example:

```text
English
বাংলা
```

Do not display selector when only one language exists.

---

# 110. Multi-Currency

When enabled:

```text
BDT
USD
EUR
```

Display selected currency clearly. Preserve authoritative order currency at checkout.

---

# 111. WhatsApp Support

Optional floating button.

Desktop: bottom-right.  
Mobile: must not block sticky actions.

Admin controls:

- Enabled
- Number
- Default message
- Availability

---

# 112. Recently Viewed

Optional section shown on:

- Homepage
- Product page
- Customer account

---

# 113. Cart Persistence

Guest carts and logged-in carts should persist according to backend rules.

Returning customers should recover cart when appropriate.

---

# 114. Template 1 — Marketplace

**Code:** `marketplace`

Visual character:

- Dense
- Promotional
- Many categories
- High product visibility

Homepage:

```text
Announcement
Header
Category Sidebar + Hero
Category Icons
Benefits
Deal of the Day
Promo Banners
Featured Product Tabs
Brands
Newsletter
Footer
```

Product cards:

- Compact
- 1:1 image
- Rating visible
- Discount badge

Best for general marketplaces and very broad catalogs.

---

# 115. Template 2 — Modern Shop

**Code:** `modern_shop`

Visual character:

- Rounded
- Spacious
- Friendly
- Balanced

Homepage:

```text
Announcement
Header
Large Hero
Round Categories
Benefits
Three Promo Cards
Featured Products
New Arrivals
Brands
Newsletter
Footer
```

Product cards:

- Rounded visual area
- Clear price
- Hover actions

Best for general retail.

---

# 116. Template 3 — Fashion Boutique

**Code:** `fashion_boutique`

Visual character:

- Editorial
- Fashion photography
- Elegant typography
- Collection focused

Homepage:

```text
Announcement
Editorial Header
Fashion Hero
Collection Categories
Campaign Banners
New Collection
Featured Products
Lookbook
Brands
Newsletter
Footer
```

Product cards:

- 4:5 image
- Clean text
- Optional color/size swatches

Best for fashion, beauty, accessories.

---

# 117. Template 4 — Minimal Store

**Code:** `minimal_store`

Visual character:

- Premium
- Minimal
- Large white space
- Image-led

Homepage:

```text
Minimal Header
Full-width Hero
Featured Collection
Editorial Categories
Selected Products
Brand Story
Best Sellers
Newsletter
Minimal Footer
```

Product cards:

- Minimal chrome
- Large image
- Name + price
- Reduced badge clutter

Best for luxury/boutique brands.

---

# 118. Template 5 — Electronics

**Code:** `electronics`

Visual character:

- Tech-focused
- Product-heavy
- Strong deals
- High contrast

Homepage:

```text
Promo Bar
Header + Large Search
Category Menu
Tech Hero
Popular Categories
Flash Deals
Featured Electronics
Best Sellers
Top Brands
Benefits
Newsletter
Footer
```

Product cards may show:

- Image
- Price
- Discount
- Rating
- Simple spec chips
- Stock

Best for phones, computers, electronics, appliances.

---

# 119. Template 6 — Lifestyle

**Code:** `lifestyle`

Visual character:

- Warm
- Editorial
- Home/living focused
- Soft premium feel

Homepage:

```text
Announcement
Minimal Header
Lifestyle Hero
Visual Categories
Editorial Banner
Featured Products
Best Sellers
Brands
Lookbook/Story
Newsletter
Footer
```

Best for furniture, decor, kitchen, handmade/lifestyle goods.

---

# 120. Template Switching

Changing template must preserve business data:

- Products
- Categories
- Brands
- Menus where compatible
- Pages
- Policies
- Domains
- Theme color if compatible

Homepage layouts may differ, so store template-specific homepage configuration or normalize sections carefully.

Recommended concept:

```text
storefront_template_configs
```

---

# 121. Theme Preview

Client Admin should support preview before publish.

Conceptually:

```text
Preview Template
Preview Color Theme
```

Use signed/authenticated preview state. Public users must not be allowed to override tenant configuration through query parameters alone.

---

# 122. Content Fallback Rules

If a dynamic section has no valid content:

- Do not show broken empty blocks
- Hide optional section
- Use defaults only where safe

Example:

No testimonials → hide Testimonials.

---

# 123. Performance-Oriented UI

Design around:

- Server rendering where appropriate
- CDN
- Image optimization
- Lazy loading
- Code splitting
- Caching
- Skeleton loading
- Controlled prefetching
- Limited homepage product counts

Do not load entire catalogs on homepage.

---

# 124. Product Pagination

Support:

- Pagination
- Load More
- Infinite scroll if later needed

Recommended first release:

- SEO listing pages: pagination/Load More
- Mobile: Load More works well

---

# 125. UI Security Rules

Never expose in the browser:

- Tenant DB credentials
- Admin secrets
- JWT signing keys
- Payment private keys
- Infrastructure details

Sanitize any rich content before rendering.

Use safe CMS blocks instead of arbitrary JavaScript.

---

# 126. Customer Trust UI

Homepage:

- Secure Payment
- Easy Returns
- Shipping
- Support

Product page:

- Delivery information
- Return policy
- Review authenticity indicators

Checkout:

- Secure checkout
- Supported payment methods
- Return/support links

Avoid fake urgency and misleading scarcity.

---

# 127. Payment Status UI

Statuses:

```text
Pending
Paid
Failed
Partially Refunded
Refunded
```

Do not show Paid before backend verification.

---

# 128. Order Status UI

```text
Pending
Confirmed
Processing
Packed
Shipped
Out for Delivery
Delivered
Cancelled
Returned
Refunded
```

Keep wording consistent across Account, Tracking, and Notifications.

---

# 129. Return Status UI

```text
Requested
Under Review
Approved
Rejected
Product Received
Inspection
Completed
Cancelled
```

---

# 130. Refund Status UI

```text
Requested
Approved
Processing
Completed
Rejected
Failed
```

---

# 131. Cart Drawer

Optional desktop feature.

Contains:

- Recently added product
- Current cart items
- Subtotal
- View Cart
- Checkout

Keep it lightweight.

---

# 132. Quick View

Optional future feature.

Can show:

- Image
- Product name
- Price
- Variants
- Add to Cart

Skip initially if it increases complexity too much.

---

# 133. Sale Page

URL:

```text
/sale
```

May contain:

- Campaign hero
- Sale product listing
- Filters
- Sorting
- Truthful countdown if configured

---

# 134. New Arrivals

URL:

```text
/new-arrivals
```

Uses standard product listing system sorted by publication date.

---

# 135. Best Sellers

URL:

```text
/best-sellers
```

Ranking comes from backend sales analytics.

---

# 136. Featured Products

Optional dedicated page:

```text
/featured
```

Admin-curated products.

---

# 137. Brands Index

URL:

```text
/brands
```

Show brand logo/name grid.

---

# 138. Categories Index

URL:

```text
/categories
```

Use template-specific category grid.

---

# 139. Complete Page Map

```text
/
├── /shop
├── /categories
│   └── /category/[slug]
├── /brands
│   └── /brand/[slug]
├── /product/[slug]
├── /search
├── /new-arrivals
├── /best-sellers
├── /sale
├── /wishlist
├── /compare
├── /cart
├── /checkout
│   ├── /success/[orderNumber]
│   └── /failure
├── /login
├── /register
├── /forgot-password
├── /reset-password
├── /verify-email
├── /account
│   ├── /orders
│   │   └── /orders/[orderNumber]
│   ├── /addresses
│   ├── /wishlist
│   ├── /returns
│   │   └── /returns/[returnNumber]
│   ├── /profile
│   └── /security
├── /returns/request/[orderNumber]
├── /track-order
├── /contact
├── /about
├── /faq
├── /privacy
├── /terms
├── /return-policy
├── /refund-policy
├── /shipping-policy
└── /[custom-cms-page]
```

---

# 140. Shared Component Map

```text
components/
├── layout/
│   ├── announcement-bar
│   ├── header
│   ├── mobile-header
│   ├── nav
│   ├── mega-menu
│   ├── mobile-menu
│   └── footer
│
├── commerce/
│   ├── product-card
│   ├── product-grid
│   ├── product-carousel
│   ├── price
│   ├── rating
│   ├── variant-selector
│   ├── quantity-selector
│   ├── stock-status
│   ├── wishlist-button
│   └── add-to-cart-button
│
├── cart/
│   ├── cart-item
│   ├── cart-summary
│   ├── cart-drawer
│   └── coupon-form
│
├── checkout/
│   ├── contact
│   ├── address-form
│   ├── shipping-methods
│   ├── payment-methods
│   └── order-summary
│
├── account/
│   ├── account-nav
│   ├── order-card
│   ├── order-timeline
│   ├── address-card
│   └── return-card
│
├── marketing/
│   ├── hero
│   ├── banner
│   ├── newsletter
│   ├── brand-carousel
│   └── category-card
│
└── ui/
    ├── button
    ├── input
    ├── select
    ├── modal
    ├── drawer
    ├── accordion
    ├── tabs
    ├── toast
    ├── badge
    ├── skeleton
    └── pagination
```

---

# 141. Storefront Configuration Object

Conceptual example:

```json
{
  "template": "fashion_boutique",
  "colorTheme": "rose_pink",
  "logo": "...",
  "favicon": "...",
  "homepage": {
    "sections": [
      {
        "type": "hero",
        "enabled": true,
        "position": 1
      },
      {
        "type": "category_grid",
        "enabled": true,
        "position": 2
      },
      {
        "type": "featured_products",
        "enabled": true,
        "position": 3
      }
    ]
  }
}
```

---

# 142. Storefront Runtime Flow

```text
Request abc-fashion.com
↓
Validate Host
↓
Resolve Tenant
↓
Load Public Tenant Store Configuration
↓
Load Template
↓
Apply Color Tokens
↓
Load Page Data
↓
Render Next.js Page
↓
Hydrate Interactive Components
```

---

# 143. Domain-Aware UI

Use the tenant's primary domain for:

- Canonical URLs
- Share links
- Checkout links
- Sitemap
- Structured data
- Public order links

If custom domain is primary, canonical URLs must use the custom domain rather than the platform subdomain.

---

# 144. Store Branding

Store owner may control:

- Logo
- Favicon
- Store name
- Template
- Color theme
- Safe font preset
- Social links
- Contact
- Footer
- Header
- Announcement bar
- Homepage content

Branding stays within controlled layout rules.

---

# 145. Admin-Driven Homepage Editing Model

Conceptual Client Admin editor:

```text
Homepage
├── Hero              [Enabled] [Edit] [Drag]
├── Categories        [Enabled] [Edit] [Drag]
├── Featured Products [Enabled] [Edit] [Drag]
├── Banner            [Enabled] [Edit] [Drag]
├── Best Sellers      [Enabled] [Edit] [Drag]
├── Brands            [Enabled] [Edit] [Drag]
└── Newsletter        [Enabled] [Edit] [Drag]
```

Storefront reads published configuration.

---

# 146. UI State Checklist

Every important page/component must define:

1. Loading
2. Success
3. Empty
4. Error
5. Unauthorized if applicable
6. Disabled
7. Out-of-stock
8. Network issue
9. Maintenance
10. Suspended tenant

---

# 147. Recommended First Release Scope

Prioritize:

- Homepage
- Shop
- Categories
- Brands
- Product details
- Search
- Filters
- Cart
- Checkout
- Customer auth
- Customer account
- Orders
- Order tracking
- Wishlist
- Returns/refunds request
- Reviews
- Policy pages
- Contact
- Custom-domain awareness
- 6 templates
- 8 color themes
- Responsive UI
- SEO
- Safe dynamic homepage blocks

Defer if needed:

- Arbitrary custom HTML
- Arbitrary JavaScript
- Highly complex page builder
- Complex recurring product subscriptions
- Excessive Quick View logic

---

# 148. Final Visual Architecture

```text
CLIENT STOREFRONT
│
├── Global
│   ├── Announcement
│   ├── Header
│   ├── Navigation
│   ├── Search
│   └── Footer
│
├── Discovery
│   ├── Homepage
│   ├── Shop
│   ├── Categories
│   ├── Brands
│   ├── Search
│   ├── New Arrivals
│   ├── Best Sellers
│   └── Sale
│
├── Product
│   ├── Product Details
│   ├── Variants
│   ├── Reviews
│   ├── Related Products
│   └── Frequently Bought Together
│
├── Shopping
│   ├── Wishlist
│   ├── Compare
│   ├── Cart
│   ├── Coupon
│   └── Checkout
│
├── Customer
│   ├── Login
│   ├── Registration
│   ├── Profile
│   ├── Addresses
│   ├── Orders
│   ├── Tracking
│   ├── Returns
│   └── Security
│
├── Information
│   ├── About
│   ├── Contact
│   ├── FAQ
│   ├── Privacy
│   ├── Terms
│   ├── Return Policy
│   └── Shipping Policy
│
└── Dynamic Design System
    ├── 6 Templates
    ├── 8 Color Themes
    ├── Dynamic Homepage Sections
    ├── Dynamic Navigation
    ├── Dynamic Branding
    └── Responsive Design Tokens
```

---

# 149. Core Storefront Rule

```text
ONE STOREFRONT CODEBASE
+
MANY TENANTS
+
DEDICATED TENANT DATABASES
+
DYNAMIC STORE CONFIGURATION
+
6 LAYOUT TEMPLATES
+
8 COLOR THEMES
=
MANY UNIQUE CLIENT WEBSITES
```

A client should be able to launch and operate a professional storefront without editing source code.

---

# 150. Developer Implementation Rule

Before implementing any storefront page:

1. Define page purpose.
2. Define desktop layout.
3. Define mobile layout.
4. Define loading state.
5. Define empty state.
6. Define error state.
7. Define API data contract.
8. Define tenant-aware data source.
9. Define SEO metadata.
10. Define accessibility behavior.
11. Define security considerations.
12. Define template-specific variation.
13. Define theme token usage.
14. Implement reusable components.
15. Test across all 6 templates and all 8 color themes.

The final result must behave as one robust **Dynamic Storefront Layout / Template System**, not six separately maintained websites.
