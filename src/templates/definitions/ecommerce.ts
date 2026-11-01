import { TemplateDefinition, TemplateSeedContext, SeedRecordResult } from '../types';
import { TemplateImageGenerator } from '../TemplateImageGenerator';

export const ecommerceTemplate: TemplateDefinition = {
  id: 'ecommerce',
  name: 'E-Commerce',
  tagline: 'Instant storefront with products, categories, orders, reviews, favorites & cart',
  description:
    'Full-featured retail schema pre-seeded with 20 realistic products, custom generated SVG product images, relational categories, customer orders, verified reviews, user favorites, and shopping cart.',
  icon: '🛒',
  badge: '20 Items & Images',
  aliases: ['ecommerce', 'e-commerce', 'shop', 'store'],
  stats: {
    collections: 6,
    records: 48,
    images: 25,
    functions: 6,
    flows: 2,
  },
  collections: [
    // 1. Categories
    {
      name: 'categories',
      dto: {
        name: 'categories',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        schema: [
          { id: 'f_cat_name', name: 'name', type: 'text', required: true },
          { id: 'f_cat_slug', name: 'slug', type: 'text', required: true, unique: true },
          { id: 'f_cat_desc', name: 'description', type: 'text' },
          { id: 'f_cat_icon', name: 'icon', type: 'text' },
          { id: 'f_cat_img', name: 'image', type: 'file' },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<SeedRecordResult[]> => {
        const categoriesData = [
          {
            id: 'cat_electronics',
            name: 'Electronics',
            slug: 'electronics',
            description: 'Next-gen audio, mechanical peripherals, visual displays & creative hardware',
            icon: 'headphones',
          },
          {
            id: 'cat_accessories',
            name: 'Accessories & EDC',
            slug: 'accessories',
            description: 'Engineered backpacks, horology timepieces, titanium optics & leather goods',
            icon: 'backpack',
          },
          {
            id: 'cat_apparel',
            name: 'Footwear & Apparel',
            slug: 'apparel',
            description: 'Merino performance wear, trail running silhouettes & daily technical basics',
            icon: 'shoe',
          },
          {
            id: 'cat_homeliving',
            name: 'Home & Living',
            slug: 'home-living',
            description: 'Ergonomic workstations, artisan coffee drippers, ambient glow & desktop craft',
            icon: 'chair',
          },
          {
            id: 'cat_wellness',
            name: 'Beauty & Wellness',
            slug: 'wellness',
            description: 'Botanical night serums, clean self-care remedies & artisanal fragrance notes',
            icon: 'bottle',
          },
        ];

        return categoriesData.map((cat, idx) => {
          const buffer = TemplateImageGenerator.generateCategorySvg(cat.name, cat.icon, idx);
          const filename = `${cat.slug}_hero.svg`;
          return {
            record: {
              id: cat.id,
              name: cat.name,
              slug: cat.slug,
              description: cat.description,
              icon: cat.icon,
              image: filename,
            },
            files: [
              {
                fieldName: 'image',
                filename,
                buffer,
                mimeType: 'image/svg+xml',
              },
            ],
          };
        });
      },
    },

    // 2. Products (pre-seeded with 20 items & images!)
    {
      name: 'products',
      dto: {
        name: 'products',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id != ""',
        deleteRule: '@request.auth.id != ""',
        schema: [
          { id: 'f_prod_name', name: 'name', type: 'text', required: true },
          { id: 'f_prod_slug', name: 'slug', type: 'text', required: true, unique: true },
          { id: 'f_prod_desc', name: 'description', type: 'text' },
          { id: 'f_prod_price', name: 'price', type: 'number', required: true },
          { id: 'f_prod_stock', name: 'stock', type: 'number', required: true },
          {
            id: 'f_prod_cat',
            name: 'category',
            type: 'relation',
            options: { collectionId: 'categories' },
          },
          { id: 'f_prod_img', name: 'image', type: 'file', required: true },
          { id: 'f_prod_rating', name: 'rating', type: 'number' },
          { id: 'f_prod_featured', name: 'isFeatured', type: 'bool' },
          {
            id: 'f_prod_status',
            name: 'status',
            type: 'select',
            options: { values: ['in_stock', 'low_stock', 'out_of_stock', 'pre_order'] },
          },
        ],
      },
      seed: async (ctx: TemplateSeedContext): Promise<SeedRecordResult[]> => {
        const catMap = ctx.collectionIdMap;
        const categoriesId = catMap.get('categories') || 'categories';

        const rawProducts = [
          {
            id: 'prod_01',
            name: 'Aura Wireless ANC Headphones',
            slug: 'aura-wireless-anc-headphones',
            description: 'Custom 40mm titanium drivers with adaptive hybrid noise cancellation and 42-hour battery life.',
            price: 299.99,
            stock: 45,
            category: 'cat_electronics',
            rating: 4.9,
            isFeatured: true,
            status: 'in_stock',
            icon: 'headphones',
          },
          {
            id: 'prod_02',
            name: 'Keychron Lumina Mechanical Keyboard',
            slug: 'keychron-lumina-mechanical-keyboard',
            description: 'Gasket-mounted CNC aluminum chassis with hot-swappable lubricated tactile switches and RGB matrix.',
            price: 189.5,
            stock: 32,
            category: 'cat_electronics',
            rating: 4.8,
            isFeatured: true,
            status: 'in_stock',
            icon: 'keyboard',
          },
          {
            id: 'prod_03',
            name: 'ViewPro 27" Ultra-HD IPS Monitor',
            slug: 'viewpro-27-ultrahd-monitor',
            description: 'Factory-calibrated 4K display with 99% DCI-P3 color gamut, 90W USB-C power delivery and pivot stand.',
            price: 449.0,
            stock: 18,
            category: 'cat_electronics',
            rating: 4.7,
            isFeatured: false,
            status: 'in_stock',
            icon: 'monitor',
          },
          {
            id: 'prod_04',
            name: 'StudioWave USB-C Condenser Mic',
            slug: 'studiowave-usbc-condenser-mic',
            description: 'Broadcast-grade cardioid capsule with zero-latency headphone monitoring and integrated shockmount.',
            price: 129.0,
            stock: 50,
            category: 'cat_electronics',
            rating: 4.6,
            isFeatured: false,
            status: 'in_stock',
            icon: 'mic',
          },
          {
            id: 'prod_05',
            name: 'Halo Ambient Desk Smart Lightbar',
            slug: 'halo-ambient-desk-lightbar',
            description: 'Asymmetric optical glare-free design with wireless dial control and circadian auto-dimming.',
            price: 79.99,
            stock: 75,
            category: 'cat_electronics',
            rating: 4.5,
            isFeatured: false,
            status: 'in_stock',
            icon: 'lamp',
          },
          {
            id: 'prod_06',
            name: 'Nomad Waterproof Daypack 24L',
            slug: 'nomad-waterproof-daypack-24l',
            description: 'Cordura ballistic nylon with magnetic Fidlock buckles, dedicated 16" laptop sleeve and weatherproof zippers.',
            price: 149.0,
            stock: 38,
            category: 'cat_accessories',
            rating: 4.8,
            isFeatured: true,
            status: 'in_stock',
            icon: 'backpack',
          },
          {
            id: 'prod_07',
            name: 'Vanguard Chronograph Titanium Watch',
            slug: 'vanguard-chronograph-titanium-watch',
            description: 'Grade 5 aerospace titanium case, sapphire crystal with anti-reflective coating and Swiss meca-quartz movement.',
            price: 389.0,
            stock: 14,
            category: 'cat_accessories',
            rating: 4.9,
            isFeatured: true,
            status: 'in_stock',
            icon: 'watch',
          },
          {
            id: 'prod_08',
            name: 'Polaris Matte Acetate Sunglasses',
            slug: 'polaris-matte-acetate-sunglasses',
            description: 'Handcrafted Italian Mazzucchelli acetate with polarized category 3 lenses providing 100% UV400 defense.',
            price: 89.0,
            stock: 64,
            category: 'cat_accessories',
            rating: 4.4,
            isFeatured: false,
            status: 'in_stock',
            icon: 'glasses',
          },
          {
            id: 'prod_09',
            name: 'Heritage Bifold Leather Wallet',
            slug: 'heritage-bifold-leather-wallet',
            description: 'Vegetable-tanned full-grain Horween leather that develops a rich natural patina over years of daily carry.',
            price: 59.95,
            stock: 90,
            category: 'cat_accessories',
            rating: 4.7,
            isFeatured: false,
            status: 'in_stock',
            icon: 'wallet',
          },
          {
            id: 'prod_10',
            name: 'Carbon Minimalist RFID Cardholder',
            slug: 'carbon-minimalist-rfid-cardholder',
            description: 'Forged 3K matte carbon fiber plates with expandable silicone band holding up to 12 cards with RFID shield.',
            price: 39.0,
            stock: 120,
            category: 'cat_accessories',
            rating: 4.6,
            isFeatured: false,
            status: 'in_stock',
            icon: 'card',
          },
          {
            id: 'prod_11',
            name: 'Alpine Thermal Merino Wool Hoodie',
            slug: 'alpine-thermal-merino-hoodie',
            description: '100% 260gsm non-mulesed New Zealand merino wool engineered for thermoregulation and odor resistance.',
            price: 125.0,
            stock: 42,
            category: 'cat_apparel',
            rating: 4.9,
            isFeatured: true,
            status: 'in_stock',
            icon: 'hoodie',
          },
          {
            id: 'prod_12',
            name: 'TerraGrip Trail Running Shoes',
            slug: 'terragrip-trail-running-shoes',
            description: 'Vibram Megagrip outsole with responsive nitrogen-infused foam midsole and ripstop protective upper.',
            price: 165.0,
            stock: 26,
            category: 'cat_apparel',
            rating: 4.7,
            isFeatured: true,
            status: 'in_stock',
            icon: 'shoe',
          },
          {
            id: 'prod_13',
            name: 'AeroFlow Seamless Training Shirt',
            slug: 'aeroflow-seamless-training-shirt',
            description: 'Body-mapped ventilation zones and moisture-wicking synthetic blend designed for high-intensity movement.',
            price: 45.0,
            stock: 80,
            category: 'cat_apparel',
            rating: 4.5,
            isFeatured: false,
            status: 'in_stock',
            icon: 'shirt',
          },
          {
            id: 'prod_14',
            name: 'UrbanCraft Canvas Low-Top Sneakers',
            slug: 'urbancraft-canvas-lowtop-sneakers',
            description: 'Heavyweight organic cotton duck canvas with vulcanized gum rubber sole and ortholite cushioned footbed.',
            price: 79.0,
            stock: 35,
            category: 'cat_apparel',
            rating: 4.3,
            isFeatured: false,
            status: 'in_stock',
            icon: 'shoe',
          },
          {
            id: 'prod_15',
            name: 'Zenith Ergonomic Breathable Chair',
            slug: 'zenith-ergonomic-breathable-chair',
            description: 'Self-adjusting synchro-tilt mechanism, 4D armrests, dynamic lumbar support and breathable mesh weave.',
            price: 349.0,
            stock: 8,
            category: 'cat_homeliving',
            rating: 4.8,
            isFeatured: true,
            status: 'low_stock',
            icon: 'chair',
          },
          {
            id: 'prod_16',
            name: 'Komorebi Cedarwood Hand Candle',
            slug: 'komorebi-cedarwood-hand-candle',
            description: 'Hand-poured 100% natural soy wax with Japanese hinoki cedar, smoked amber, and unbleached cotton wick.',
            price: 34.0,
            stock: 95,
            category: 'cat_homeliving',
            rating: 4.9,
            isFeatured: false,
            status: 'in_stock',
            icon: 'candle',
          },
          {
            id: 'prod_17',
            name: 'Barista Precision Ceramic Dripper',
            slug: 'barista-precision-ceramic-dripper',
            description: 'Mino-yaki handcrafted ceramic pour-over funnel optimized for even thermal retention and extraction rate.',
            price: 48.0,
            stock: 40,
            category: 'cat_homeliving',
            rating: 4.7,
            isFeatured: false,
            status: 'in_stock',
            icon: 'coffee',
          },
          {
            id: 'prod_18',
            name: 'Nordic Solid Oak Floating Desk Riser',
            slug: 'nordic-solid-oak-desk-riser',
            description: 'FSC-certified solid European white oak with felt-lined aluminum legs and integrated cork cable channel.',
            price: 85.0,
            stock: 22,
            category: 'cat_homeliving',
            rating: 4.6,
            isFeatured: false,
            status: 'in_stock',
            icon: 'shelf',
          },
          {
            id: 'prod_19',
            name: 'Botanical Renewal Facial Night Oil',
            slug: 'botanical-renewal-facial-night-oil',
            description: 'Cold-pressed organic rosehip, squalane, blue tansy, and marula seed extract for nighttime barrier repair.',
            price: 58.0,
            stock: 60,
            category: 'cat_wellness',
            rating: 4.9,
            isFeatured: false,
            status: 'in_stock',
            icon: 'bottle',
          },
          {
            id: 'prod_20',
            name: 'Santal & Amber Organic Eau de Parfum',
            slug: 'santal-amber-organic-eau-de-parfum',
            description: 'Sustainably sourced Mysore sandalwood, warm labdanum amber, cardamon, and crisp bergamot notes.',
            price: 95.0,
            stock: 25,
            category: 'cat_wellness',
            rating: 4.8,
            isFeatured: true,
            status: 'in_stock',
            icon: 'perfume',
          },
        ];

        return rawProducts.map((p, idx) => {
          const buffer = TemplateImageGenerator.generateProductSvg(
            {
              title: p.name,
              category: p.category.replace('cat_', ''),
              price: p.price,
              icon: p.icon,
            },
            idx
          );
          const filename = `${p.slug}.svg`;

          return {
            record: {
              id: p.id,
              name: p.name,
              slug: p.slug,
              description: p.description,
              price: p.price,
              stock: p.stock,
              category: p.category,
              image: filename,
              rating: p.rating,
              isFeatured: p.isFeatured ? 1 : 0,
              status: p.status,
            },
            files: [
              {
                fieldName: 'image',
                filename,
                buffer,
                mimeType: 'image/svg+xml',
              },
            ],
          };
        });
      },
    },

    // 3. Orders
    {
      name: 'orders',
      dto: {
        name: 'orders',
        type: 'base',
        listRule: '@request.auth.id != "" && user = @request.auth.id',
        viewRule: '@request.auth.id != "" && user = @request.auth.id',
        createRule: '@request.auth.id != "" && user = @request.auth.id',
        updateRule: '@request.auth.id != "" && user = @request.auth.id',
        deleteRule: null,
        schema: [
          { id: 'f_ord_no', name: 'orderNumber', type: 'text', required: true, unique: true },
          { id: 'f_ord_user', name: 'user', type: 'relation', options: { collectionId: 'users' } },
          { id: 'f_ord_cust', name: 'customerName', type: 'text', required: true },
          { id: 'f_ord_email', name: 'customerEmail', type: 'email', required: true },
          {
            id: 'f_ord_status',
            name: 'status',
            type: 'select',
            options: { values: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] },
          },
          { id: 'f_ord_total', name: 'total', type: 'number', required: true },
          { id: 'f_ord_items', name: 'items', type: 'json' },
          { id: 'f_ord_addr', name: 'shippingAddress', type: 'text' },
          {
            id: 'f_ord_pay',
            name: 'paymentStatus',
            type: 'select',
            options: { values: ['paid', 'pending', 'refunded', 'failed'] },
          },
          { id: 'f_ord_discount', name: 'discount', type: 'number' },
          { id: 'f_ord_coupon', name: 'couponCode', type: 'text' },
          { id: 'f_ord_tracking', name: 'trackingNumber', type: 'text' },
          { id: 'f_ord_carrier', name: 'carrier', type: 'text' },
          { id: 'f_ord_points', name: 'loyaltyPoints', type: 'number' },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
        return [
          {
            id: 'ord_1001',
            orderNumber: 'ORD-9801',
            customerName: 'Marcus Vance',
            customerEmail: 'marcus.vance@example.com',
            status: 'delivered',
            total: 359.98,
            items: JSON.stringify([
              { productId: 'prod_01', name: 'Aura Wireless ANC Headphones', quantity: 1, price: 299.99 },
              { productId: 'prod_09', name: 'Heritage Bifold Leather Wallet', quantity: 1, price: 59.95 },
            ]),
            shippingAddress: '742 Evergreen Terrace, Austin, TX 78701',
            paymentStatus: 'paid',
            discount: 60.00,
            couponCode: 'SAVE20',
            trackingNumber: 'TRK-US-890124',
            carrier: 'FedEx Priority Express',
            loyaltyPoints: 3590,
          },
          {
            id: 'ord_1002',
            orderNumber: 'ORD-9802',
            customerName: 'Elena Rodriguez',
            customerEmail: 'elena.rodriguez@techcorp.io',
            status: 'delivered',
            total: 638.5,
            items: JSON.stringify([
              { productId: 'prod_02', name: 'Keychron Lumina Mechanical Keyboard', quantity: 1, price: 189.5 },
              { productId: 'prod_03', name: 'ViewPro 27" Ultra-HD IPS Monitor', quantity: 1, price: 449.0 },
            ]),
            shippingAddress: '350 Fifth Ave, Floor 42, New York, NY 10118',
            paymentStatus: 'paid',
          },
          {
            id: 'ord_1003',
            orderNumber: 'ORD-9803',
            customerName: 'David Chen',
            customerEmail: 'david.chen@cloudstack.dev',
            status: 'shipped',
            total: 149.0,
            items: JSON.stringify([
              { productId: 'prod_06', name: 'Nomad Waterproof Daypack 24L', quantity: 1, price: 149.0 },
            ]),
            shippingAddress: '88 Market St, Suite 500, San Francisco, CA 94105',
            paymentStatus: 'paid',
          },
          {
            id: 'ord_1004',
            orderNumber: 'ORD-9804',
            customerName: 'Sarah Jenkins',
            customerEmail: 'sarah.jenkins@venturelab.net',
            status: 'processing',
            total: 474.0,
            items: JSON.stringify([
              { productId: 'prod_15', name: 'Zenith Ergonomic Breathable Chair', quantity: 1, price: 349.0 },
              { productId: 'prod_11', name: 'Alpine Thermal Merino Wool Hoodie', quantity: 1, price: 125.0 },
            ]),
            shippingAddress: '10 Downing St, London, UK SW1A 2AA',
            paymentStatus: 'paid',
          },
          {
            id: 'ord_1005',
            orderNumber: 'ORD-9805',
            customerName: 'Liam O\'Connor',
            customerEmail: 'liam.oconnor@acmemail.org',
            status: 'pending',
            total: 129.0,
            items: JSON.stringify([
              { productId: 'prod_04', name: 'StudioWave USB-C Condenser Mic', quantity: 1, price: 129.0 },
            ]),
            shippingAddress: '19 High St, Dublin, Ireland D08',
            paymentStatus: 'pending',
          },
          {
            id: 'ord_1006',
            orderNumber: 'ORD-9806',
            customerName: 'Sophia Kim',
            customerEmail: 'sophia.kim@startup.co',
            status: 'delivered',
            total: 153.0,
            items: JSON.stringify([
              { productId: 'prod_19', name: 'Botanical Renewal Facial Night Oil', quantity: 1, price: 58.0 },
              { productId: 'prod_20', name: 'Santal & Amber Organic Eau de Parfum', quantity: 1, price: 95.0 },
            ]),
            shippingAddress: '128 Technology Drive, Seattle, WA 98101',
            paymentStatus: 'paid',
          },
          {
            id: 'ord_1007',
            orderNumber: 'ORD-9807',
            customerName: 'Lucas Patel',
            customerEmail: 'lucas.patel@nexus.org',
            status: 'shipped',
            total: 210.0,
            items: JSON.stringify([
              { productId: 'prod_12', name: 'TerraGrip Trail Running Shoes', quantity: 1, price: 165.0 },
              { productId: 'prod_13', name: 'AeroFlow Seamless Training Shirt', quantity: 1, price: 45.0 },
            ]),
            shippingAddress: '456 Innovation Way, Toronto, ON M5V 2T6',
            paymentStatus: 'paid',
          },
          {
            id: 'ord_1008',
            orderNumber: 'ORD-9808',
            customerName: 'Emma Thompson',
            customerEmail: 'emma.t@example.com',
            status: 'delivered',
            total: 82.0,
            items: JSON.stringify([
              { productId: 'prod_16', name: 'Komorebi Cedarwood Hand Candle', quantity: 1, price: 34.0 },
              { productId: 'prod_17', name: 'Barista Precision Ceramic Dripper', quantity: 1, price: 48.0 },
            ]),
            shippingAddress: '221B Baker Street, London, UK NW1 6XE',
            paymentStatus: 'paid',
          },
        ];
      },
    },

    // 4. Reviews
    {
      name: 'reviews',
      dto: {
        name: 'reviews',
        type: 'base',
        listRule: '',
        viewRule: '',
        createRule: '@request.auth.id != "" && user = @request.auth.id',
        updateRule: '@request.auth.id != "" && user = @request.auth.id',
        deleteRule: '@request.auth.id != "" && user = @request.auth.id',
        schema: [
          {
            id: 'f_rev_prod',
            name: 'product',
            type: 'relation',
            options: { collectionId: 'products' },
          },
          { id: 'f_rev_user', name: 'user', type: 'relation', required: true, options: { collectionId: 'users' } },
          { id: 'f_rev_author', name: 'author', type: 'text', required: true },
          { id: 'f_rev_rating', name: 'rating', type: 'number', required: true },
          { id: 'f_rev_title', name: 'title', type: 'text' },
          { id: 'f_rev_content', name: 'content', type: 'text', required: true },
          { id: 'f_rev_verified', name: 'verifiedPurchase', type: 'bool' },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
        return [
          {
            id: 'rev_01',
            product: 'prod_01',
            author: 'Marcus Vance',
            rating: 5,
            title: 'Incredible soundstage and ANC depth',
            content: 'The active noise cancellation blocks low rumble instantly on flights. Bluetooth multipoint switches between MacBook and iPhone seamlessly.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_02',
            product: 'prod_01',
            author: 'Chloe Adams',
            rating: 5,
            title: 'Worth every penny for focus work',
            content: 'Battery lasts the entire work week without charging. The memory foam cushions breathe well even during 8-hour sprint sessions.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_03',
            product: 'prod_02',
            author: 'Elena Rodriguez',
            rating: 5,
            title: 'The acoustic profile is pristine',
            content: 'Factory lubrication on the switches gives a deep, satisfying thock without pinging. Keycaps have crisp legends and nice texture.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_04',
            product: 'prod_03',
            author: 'David Chen',
            rating: 4,
            title: 'Stunning color reproduction',
            content: '99% DCI-P3 is noticeable for color grading and design reviews. The 90W single-cable USB-C connection powers my laptop flawlessly.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_05',
            product: 'prod_06',
            author: 'Alex Taylor',
            rating: 5,
            title: 'Ideal minimalist everyday carry',
            content: 'Survived heavy rain in Tokyo with electronics completely dry. The Fidlock magnetic buckles snap into place with one hand.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_06',
            product: 'prod_07',
            author: 'Gabriel Scott',
            rating: 5,
            title: 'Lightweight titanium elegance',
            content: 'The titanium weight is astonishingly light on the wrist. Anti-reflective sapphire coating makes the dial readable under direct sunlight.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_07',
            product: 'prod_11',
            author: 'Sarah Jenkins',
            rating: 5,
            title: 'My absolute go-to travel layer',
            content: 'Super soft merino wool with zero scratchiness. Naturally odor-resistant after 3 days of backcountry trekking.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_08',
            product: 'prod_12',
            author: 'Lucas Patel',
            rating: 5,
            title: 'Unbelievable traction on wet rock',
            content: 'The Megagrip lugs bite into loose mud and wet granite with immense confidence. Toe cap protection prevents painful stubs.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_09',
            product: 'prod_15',
            author: 'Julian King',
            rating: 5,
            title: 'Saved my lower back',
            content: 'The dynamic lumbar support engages naturally when reclining. The mesh seat remains cool through hot summer afternoons.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_10',
            product: 'prod_16',
            author: 'Emma Thompson',
            rating: 5,
            title: 'Subtle and grounding scent',
            content: 'Not overpowering like synthetic candles. Fills the room with authentic cedarwood and hinoki forest notes.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_11',
            product: 'prod_17',
            author: 'Nathan Green',
            rating: 5,
            title: 'Perfect pour-over consistency',
            content: 'Rib geometry produces balanced flow rates and clean cup clarity. The ceramic matte glaze looks gorgeous on the coffee bar.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_12',
            product: 'prod_19',
            author: 'Sophia Kim',
            rating: 5,
            title: 'Skin feels replenished by morning',
            content: 'Non-comedogenic oil that sinks right in without a greasy film. Calms redness overnight significantly.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_13',
            product: 'prod_20',
            author: 'Zoe Martinez',
            rating: 5,
            title: 'Sophisticated and long-lasting',
            content: 'Warm sandalwood and amber with a crisp opening. Projects gently without being cloying.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_14',
            product: 'prod_04',
            author: 'Hannah Lee',
            rating: 4,
            title: 'Great clarity for podcasts & voice calls',
            content: 'Picks up vocal warmth while rejecting background keyboard clatter. Direct USB-C plug and play on Mac and Windows.',
            verifiedPurchase: 1,
          },
          {
            id: 'rev_15',
            product: 'prod_05',
            author: 'Amelia Clark',
            rating: 5,
            title: 'Eliminated eye strain at night',
            content: 'Front desk surface is illuminated brightly while leaving the monitor completely glare-free. The wireless dial is so satisfying.',
            verifiedPurchase: 1,
          },
        ];
      },
    },
    // 5. Favorites
    {
      name: 'favorites',
      dto: {
        name: 'favorites',
        type: 'base',
        listRule: '@request.auth.id != "" && user = @request.auth.id',
        viewRule: '@request.auth.id != "" && user = @request.auth.id',
        createRule: '@request.auth.id != "" && user = @request.auth.id',
        updateRule: '@request.auth.id != "" && user = @request.auth.id',
        deleteRule: '@request.auth.id != "" && user = @request.auth.id',
        schema: [
          {
            id: 'f_fav_user',
            name: 'user',
            type: 'relation',
            required: true,
            options: { collectionId: 'users' },
          },
          {
            id: 'f_fav_prod',
            name: 'product',
            type: 'relation',
            required: true,
            options: { collectionId: 'products' },
          },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
        return [];
      },
    },
    // 6. Cart Items (Persistent Server-side Shopping Cart)
    {
      name: 'cart_items',
      dto: {
        name: 'cart_items',
        type: 'base',
        listRule: '@request.auth.id != "" && user = @request.auth.id',
        viewRule: '@request.auth.id != "" && user = @request.auth.id',
        createRule: '@request.auth.id != "" && user = @request.auth.id',
        updateRule: '@request.auth.id != "" && user = @request.auth.id',
        deleteRule: '@request.auth.id != "" && user = @request.auth.id',
        schema: [
          {
            id: 'f_cart_user',
            name: 'user',
            type: 'relation',
            required: true,
            options: { collectionId: 'users' },
          },
          {
            id: 'f_cart_prod',
            name: 'product',
            type: 'relation',
            required: true,
            options: { collectionId: 'products' },
          },
          {
            id: 'f_cart_qty',
            name: 'quantity',
            type: 'number',
            required: true,
          },
        ],
      },
      seed: async (_ctx: TemplateSeedContext): Promise<Array<Record<string, any>>> => {
        return [];
      },
    },
  ],
  functions: [
  {
    "name": "calculate-discount",
    "description": "Serverless coupon & discount calculator engine with tier rules and execution logging",
    "enabled": true,
    "authPolicy": "public",
    "methods": [
      "POST",
      "GET"
    ],
    "timeoutMs": 2000,
    "memoryLimitMb": 32,
    "allowedDomains": [],
    "elevated": false,
    "env": {},
    "code": "export default async function(ctx) {\n  const payload = ctx.request?.body || ctx.request?.query || {};\n  const code = (payload.couponCode || payload.code || '').trim().toUpperCase();\n  const total = Number(payload.cartTotal ?? payload.subtotal ?? 0);\n  const items = payload.items || [];\n\n  ctx.log(`[calculate-discount] Evaluating coupon \"${code}\" for total ${total.toFixed(2)} with ${items.length} items`);\n\n  if (!code) {\n    return {\n      status: 400,\n      body: { valid: false, message: 'Please provide a coupon code.' }\n    };\n  }\n\n  const COUPONS = {\n    'WELCOME10': { type: 'percent', value: 10, minTotal: 0, desc: '10% off your entire order' },\n    'SAVE20': { type: 'percent', value: 20, minTotal: 75, desc: '20% off orders over $75' },\n    'FLAT50': { type: 'fixed', value: 50, minTotal: 150, desc: '$50 off orders over $150' },\n    'FREESHIP': { type: 'shipping', value: 100, minTotal: 0, desc: 'Free express shipping on your order' },\n    'VIP30': { type: 'percent', value: 30, minTotal: 200, desc: '30% VIP discount on orders over $200' },\n  };\n\n  const coupon = COUPONS[code];\n  if (!coupon) {\n    ctx.log(`[calculate-discount] Invalid coupon code: \"${code}\"`);\n    return {\n      status: 400,\n      body: {\n        valid: false,\n        code: code,\n        message: `Invalid coupon \"${code}\". Try SAVE20, WELCOME10, FLAT50, or FREESHIP.`\n      }\n    };\n  }\n\n  if (total < coupon.minTotal) {\n    return {\n      status: 400,\n      body: {\n        valid: false,\n        code: code,\n        message: `Coupon \"${code}\" requires a minimum order of ${coupon.minTotal.toFixed(2)} (current: ${total.toFixed(2)}).`\n      }\n    };\n  }\n\n  let discountAmount = 0;\n  let freeShipping = false;\n\n  if (coupon.type === 'percent') {\n    discountAmount = Math.round(total * (coupon.value / 100) * 100) / 100;\n  } else if (coupon.type === 'fixed') {\n    discountAmount = Math.min(total, coupon.value);\n  } else if (coupon.type === 'shipping') {\n    freeShipping = true;\n  }\n\n  const newTotal = Math.max(0, Math.round((total - discountAmount) * 100) / 100);\n\n  ctx.log(`[calculate-discount] Successfully applied \"${code}\": discount=${discountAmount.toFixed(2)}, newTotal=${newTotal.toFixed(2)}`);\n\n  return {\n    status: 200,\n    headers: {\n      'x-discount-code': code,\n      'x-savings-amount': String(discountAmount),\n    },\n    body: {\n      valid: true,\n      code: code,\n      type: coupon.type,\n      description: coupon.desc,\n      discountPercent: coupon.type === 'percent' ? coupon.value : 0,\n      discountAmount,\n      freeShipping,\n      minTotal: coupon.minTotal,\n      originalTotal: total,\n      newTotal,\n      message: `Coupon applied! ${coupon.desc}`\n    }\n  };\n}"
  },
  {
    "name": "validate-order",
    "description": "Validates order payload, customer address, line item existence, prices, and stock sufficiency against catalog",
    "enabled": true,
    "authPolicy": "public",
    "methods": [
      "POST"
    ],
    "timeoutMs": 2000,
    "memoryLimitMb": 32,
    "allowedDomains": [],
    "elevated": true,
    "env": {},
    "code": "export default async function(ctx) {\n  const order = ctx.request?.body?.record || ctx.request?.body || {};\n  ctx.log(`[validate-order] Validating order #${order.orderNumber || 'new'} for ${order.customerEmail}`);\n\n  let items = [];\n  try {\n    items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);\n  } catch {\n    items = [];\n  }\n\n  const issues = [];\n  if (!order.customerEmail || !order.customerEmail.includes('@')) {\n    issues.push('Invalid customer email address');\n  }\n  if (!order.shippingAddress || order.shippingAddress.trim().length < 5) {\n    issues.push('Shipping address is required');\n  }\n  if (!Array.isArray(items) || items.length === 0) {\n    issues.push('Order contains no line items');\n  }\n\n  // Validate line items against catalog\n  for (const item of items) {\n    const prodId = item.productId || item.id;\n    if (!prodId) {\n      issues.push('Line item is missing product ID');\n      continue;\n    }\n\n    const qty = Number(item.quantity);\n    if (!qty || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {\n      issues.push(`Invalid quantity (${item.quantity}) for item \"${item.name || prodId}\"`);\n      continue;\n    }\n\n    try {\n      const product = await ctx.records.get('products', prodId);\n      if (!product) {\n        issues.push(`Product \"${item.name || prodId}\" does not exist in catalog`);\n        continue;\n      }\n\n      const availableStock = Number(product.stock ?? 0);\n      if (availableStock < qty) {\n        issues.push(`Insufficient stock for \"${product.name}\" (requested: ${qty}, available: ${availableStock})`);\n      }\n\n      const catalogPrice = Number(product.price);\n      const itemPrice = Number(item.price);\n      if (item.price !== undefined && !isNaN(catalogPrice) && !isNaN(itemPrice) && Math.abs(catalogPrice - itemPrice) > 0.01) {\n        issues.push(`Price mismatch for \"${product.name}\" (catalog: ${catalogPrice.toFixed(2)}, submitted: ${itemPrice.toFixed(2)})`);\n      }\n    } catch (err) {\n      issues.push(`Failed to verify product \"${prodId}\": ${err.message}`);\n    }\n  }\n\n  const passed = issues.length === 0;\n  ctx.log(`[validate-order] Order #${order.orderNumber} validation result: passed=${passed}, issues=${issues.length}`);\n\n  return {\n    status: 200,\n    body: {\n      passed,\n      orderNumber: order.orderNumber,\n      itemCount: items.length,\n      issues,\n      riskScore: passed ? 'low' : 'high',\n      timestamp: new Date().toISOString()\n    }\n  };\n}"
  },
  {
    "name": "update-inventory",
    "description": "Decrements stock levels in products collection for purchased items",
    "enabled": true,
    "authPolicy": "admin",
    "methods": [
      "POST"
    ],
    "timeoutMs": 3000,
    "memoryLimitMb": 32,
    "allowedDomains": [],
    "elevated": true,
    "env": {},
    "code": "export default async function(ctx) {\n  const auth = ctx.request?.auth;\n  if (!auth?.role?.includes('admin') && auth?.role !== 'service-role' && !auth?.isAdmin) {\n    return {\n      status: 403,\n      body: {\n        error: 'Forbidden',\n        message: 'Admin or service-role privileges required to update inventory'\n      }\n    };\n  }\n\n  const order = ctx.request?.body?.record || ctx.request?.body || {};\n  let items = [];\n  try {\n    items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);\n  } catch {\n    items = [];\n  }\n\n  ctx.log(`[update-inventory] Decrementing inventory for ${items.length} items from order #${order.orderNumber}`);\n  const updatedProducts = [];\n\n  for (const item of items) {\n    const prodId = item.productId || item.id;\n    if (!prodId) continue;\n\n    try {\n      const product = await ctx.records.get('products', prodId);\n      if (product) {\n        const qty = Number(item.quantity || 1);\n        const currentStock = Number(product.stock || 0);\n        const newStock = Math.max(0, currentStock - qty);\n        const newStatus = newStock === 0 ? 'out_of_stock' : (newStock < 10 ? 'low_stock' : 'in_stock');\n\n        await ctx.records.update('products', prodId, {\n          stock: newStock,\n          status: newStatus\n        });\n\n        updatedProducts.push({ id: prodId, name: product.name, prevStock: currentStock, newStock });\n        ctx.log(`[update-inventory] Updated ${product.name} (ID: ${prodId}): ${currentStock} -> ${newStock}`);\n      }\n    } catch (err) {\n      ctx.log(`[update-inventory] Error updating stock for item ${prodId}: ${err.message}`);\n    }\n  }\n\n  return {\n    status: 200,\n    body: {\n      success: true,\n      orderNumber: order.orderNumber,\n      itemsProcessed: updatedProducts.length,\n      updates: updatedProducts\n    }\n  };\n}"
  },
  {
    "name": "generate-tracking-label",
    "description": "Generates carrier shipping label, tracking number, and dispatch ETA",
    "enabled": true,
    "authPolicy": "public",
    "methods": [
      "POST"
    ],
    "timeoutMs": 2000,
    "memoryLimitMb": 32,
    "allowedDomains": [],
    "elevated": false,
    "env": {},
    "code": "export default async function(ctx) {\n  const order = ctx.request?.body?.record || ctx.request?.body || {};\n  const randCode = Math.floor(100000 + Math.random() * 900000);\n  const carriers = ['FedEx Priority Express', 'DHL Express Air', 'UPS Worldwide'];\n  const carrier = carriers[Math.floor(Math.random() * carriers.length)];\n  const trackingNumber = `TRK-US-${randCode}`;\n\n  const eta = new Date();\n  eta.setDate(eta.getDate() + 3);\n\n  ctx.log(`[generate-tracking-label] Generated label for order #${order.orderNumber}: ${carrier} - ${trackingNumber}`);\n\n  return {\n    status: 200,\n    body: {\n      success: true,\n      carrier,\n      trackingNumber,\n      estimatedDelivery: eta.toISOString().split('T')[0],\n      dispatchedAt: new Date().toISOString()\n    }\n  };\n}"
  },
  {
    "name": "grant-loyalty-points",
    "description": "Awards customer VIP reward points based on order total",
    "enabled": true,
    "authPolicy": "public",
    "methods": [
      "POST"
    ],
    "timeoutMs": 2000,
    "memoryLimitMb": 32,
    "allowedDomains": [],
    "elevated": false,
    "env": {},
    "code": "export default async function(ctx) {\n  const order = ctx.request?.body?.record || ctx.request?.body || {};\n  const total = Number(order.total || 0);\n  const pointsPerDollar = 10;\n  const pointsAwarded = Math.round(total * pointsPerDollar);\n\n  let tier = 'Bronze';\n  if (total >= 400) tier = 'Platinum';\n  else if (total >= 200) tier = 'Gold';\n  else if (total >= 100) tier = 'Silver';\n\n  ctx.log(`[grant-loyalty-points] Customer ${order.customerEmail} awarded ${pointsAwarded} VIP points (Tier: ${tier})`);\n\n  return {\n    status: 200,\n    body: {\n      success: true,\n      customerEmail: order.customerEmail,\n      pointsAwarded,\n      loyaltyTier: tier,\n      message: `Congratulations! You earned ${pointsAwarded.toLocaleString()} VIP reward points.`\n    }\n  };\n}"
  },
  {
    "name": "send-order-notification",
    "description": "Dispatches order confirmation receipt, tracking link, and updates order fulfillment record",
    "enabled": true,
    "authPolicy": "admin",
    "methods": [
      "POST"
    ],
    "timeoutMs": 3000,
    "memoryLimitMb": 32,
    "allowedDomains": [],
    "elevated": true,
    "env": {},
    "code": "export default async function(ctx) {\n  const auth = ctx.request?.auth;\n  if (!auth?.role?.includes('admin') && auth?.role !== 'service-role' && !auth?.isAdmin) {\n    return {\n      status: 403,\n      body: {\n        error: 'Forbidden',\n        message: 'Admin or service-role privileges required to send order notification'\n      }\n    };\n  }\n\n  const body = ctx.request?.body || {};\n  const order = body.record || body.order || body;\n  const tracking = body.fulfillment?.[1] || body.shippingResult || body.tracking || {};\n  const vip = body.vipRewards || {};\n\n  const trackingNumber = tracking.trackingNumber || `TRK-US-${Math.floor(100000 + Math.random() * 900000)}`;\n  const carrier = tracking.carrier || 'FedEx Priority Express';\n  const loyaltyPoints = Number(vip.pointsAwarded || 0);\n\n  ctx.log(`[send-order-notification] Finalizing order #${order.orderNumber}: tracking=${trackingNumber}, points=${loyaltyPoints}`);\n\n  if (order.id) {\n    try {\n      await ctx.records.update('orders', order.id, {\n        status: 'processing',\n        trackingNumber: trackingNumber,\n        carrier: carrier,\n        loyaltyPoints: loyaltyPoints\n      });\n      ctx.log(`[send-order-notification] Updated order record ${order.id} with tracking number & loyalty points.`);\n    } catch (err) {\n      ctx.log(`[send-order-notification] Note updating order record: ${err.message}`);\n    }\n  }\n\n  return {\n    status: 200,\n    body: {\n      notified: true,\n      orderNumber: order.orderNumber,\n      recipient: order.customerEmail,\n      carrier,\n      trackingNumber,\n      loyaltyPoints,\n      sentAt: new Date().toISOString()\n    }\n  };\n}"
  }
],
  flows: [
  {
    "name": "OrderFulfillmentFlow",
    "description": "Automated order processing pipeline with validation, parallel inventory & tracking fulfillment, and VIP rewards",
    "enabled": true,
    "triggerType": "event",
    "eventTrigger": "orders:create",
    "definition": {
      "comment": "Automated e-commerce order fulfillment state machine pipeline",
      "startAt": "ValidateOrder",
      "states": {
        "ValidateOrder": {
          "type": "Task",
          "function": "validate-order",
          "resultPath": "$.validation",
          "next": "CheckFraudRisk"
        },
        "CheckFraudRisk": {
          "type": "Choice",
          "choices": [
            {
              "variable": "$.validation.passed",
              "booleanEquals": false,
              "next": "ValidationFailed"
            }
          ],
          "default": "ProcessFulfillment"
        },
        "ProcessFulfillment": {
          "type": "Parallel",
          "branches": [
            {
              "startAt": "DeductInventory",
              "states": {
                "DeductInventory": {
                  "type": "Task",
                  "function": "update-inventory",
                  "serviceRole": true,
                  "end": true
                }
              }
            },
            {
              "startAt": "CreateShippingLabel",
              "states": {
                "CreateShippingLabel": {
                  "type": "Task",
                  "function": "generate-tracking-label",
                  "end": true
                }
              }
            }
          ],
          "resultPath": "$.fulfillment",
          "next": "CheckHighValueVIP"
        },
        "CheckHighValueVIP": {
          "type": "Choice",
          "choices": [
            {
              "variable": "$.record.total",
              "numericGreaterThanEquals": 200,
              "next": "AwardVipPoints"
            }
          ],
          "default": "NotifyCustomer"
        },
        "AwardVipPoints": {
          "type": "Task",
          "function": "grant-loyalty-points",
          "resultPath": "$.vipRewards",
          "next": "NotifyCustomer"
        },
        "NotifyCustomer": {
          "type": "Task",
          "function": "send-order-notification",
          "serviceRole": true,
          "resultPath": "$.notification",
          "next": "OrderFulfilled"
        },
        "OrderFulfilled": {
          "type": "Succeed"
        },
        "ValidationFailed": {
          "type": "Fail",
          "error": "ORDER_VALIDATION_FAILED",
          "cause": "Order validation failed during fulfillment pipeline"
        }
      }
    }
  },
  {
    "name": "CheckoutPromotionFlow",
    "description": "Step-function pipeline evaluating promo codes and unlocking bundle perks",
    "enabled": true,
    "triggerType": "http",
    "definition": {
      "comment": "Interactive checkout pricing and promotion rules pipeline",
      "startAt": "ApplyCoupon",
      "states": {
        "ApplyCoupon": {
          "type": "Task",
          "function": "calculate-discount",
          "resultPath": "$.discountResult",
          "next": "CheckBundleThreshold"
        },
        "CheckBundleThreshold": {
          "type": "Choice",
          "choices": [
            {
              "variable": "$.cartTotal",
              "numericGreaterThanEquals": 150,
              "next": "GrantGiftCredit"
            }
          ],
          "default": "FinalizePricing"
        },
        "GrantGiftCredit": {
          "type": "Pass",
          "result": {
            "unlockedPerk": "Free Premium Express Packaging + $15 Gift Credit",
            "giftCredit": 15
          },
          "resultPath": "$.bundlePerk",
          "next": "FinalizePricing"
        },
        "FinalizePricing": {
          "type": "Pass",
          "next": "PricingSuccess"
        },
        "PricingSuccess": {
          "type": "Succeed"
        }
      }
    }
  }
],
};
