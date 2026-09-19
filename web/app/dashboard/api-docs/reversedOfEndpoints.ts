// AUTO-GENERATED — reverse-engineered OnlyFans /api2/v2 endpoints.
export const reversedOfEndpoints = [
  {
    "method": "POST",
    "path": "/api2/v2/accepted-cookies",
    "description": "Record cookie consent",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/address",
    "description": "Save address",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/address/stat",
    "description": "Record address statistics",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/age-verifier/start",
    "description": "Start age verification",
    "category": "Auth"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/alternative-payment-methods",
    "description": "Delete alternative payment method",
    "category": "Payments",
    "body": "{\"id\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/alternative-payment-methods",
    "description": "✓ List alternative payment methods",
    "category": "Payments"
  },
  {
    "method": "POST",
    "path": "/api2/v2/alternative-payment-methods/form",
    "description": "Submit alternative payment method form",
    "category": "Payments"
  },
  {
    "method": "POST",
    "path": "/api2/v2/alternative-payment-methods/pay",
    "description": "Pay via alternative method",
    "category": "Payments"
  },
  {
    "method": "GET",
    "path": "/api2/v2/alternative-payment-methods/paypal",
    "description": "✓ Get PayPal payment method info",
    "category": "Payments"
  },
  {
    "method": "POST",
    "path": "/api2/v2/av/email-check",
    "description": "Check account email",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/campaigns/transition",
    "description": "Transition a campaign state",
    "category": "Promotions"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/campaigns/{campaign_id}",
    "description": "Delete campaign",
    "category": "Promotions"
  },
  {
    "method": "POST",
    "path": "/api2/v2/chats/mark-as-read",
    "description": "Mark chats as read",
    "category": "Chats"
  },
  {
    "method": "GET",
    "path": "/api2/v2/chats/{user_id}/messages/{message_id}",
    "description": "Get single chat message",
    "category": "Chats"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/comments/{comment_id}",
    "description": "Delete a comment",
    "category": "Posts"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/comments/{comment_id}/like",
    "description": "Unlike a comment",
    "category": "Posts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/comments/{comment_id}/like",
    "description": "Like a comment",
    "category": "Posts"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/comments/{comment_id}/pin",
    "description": "Unpin a comment",
    "category": "Posts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/comments/{comment_id}/pin",
    "description": "Pin a comment",
    "category": "Posts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/consent-form",
    "description": "Submit consent form",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/countries/payouts",
    "description": "✓ List payout-supported countries",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/countries/{country_id}/address/expand",
    "description": "Expand address for country",
    "category": "Other",
    "body": "{\"hash\": \"\", \"isLatin\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/countries/{country_id}/states",
    "description": "List states for a country",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/earnings/chart",
    "description": "✓ Get earnings chart data",
    "category": "Earnings"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/emails/change",
    "description": "Cancel pending email change",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/emails/change",
    "description": "Request email address change",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/emails/resend",
    "description": "Resend confirmation email",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/face-id/postpone",
    "description": "Postpone face-ID verification",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/face-id/start",
    "description": "Start Face ID verification",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/guests/{guest_id}",
    "description": "Get guest details",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/guests/{guest_id}/assign",
    "description": "Assign a guest",
    "category": "Other"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/helpers/{helper_id}",
    "description": "Remove account helper",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/helpers/{user_id}",
    "description": "Add or update account helper",
    "category": "Users",
    "body": "{\"permissions\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/ip",
    "description": "✓ Get client IP address",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/iso/countries/{country_id}/states",
    "description": "List states for country",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/issues/login",
    "description": "Report login issue",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/iv/start",
    "description": "Start identity verification",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/iv/yoti-face-id-url/{id}/{token}",
    "description": "Get Yoti face-ID verification URL",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/iv/yoti-redirect-url/{verification_id}",
    "description": "Get Yoti identity verification URL",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/labels/sort",
    "description": "Sort labels",
    "category": "Labels"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/labels/{label_id}",
    "description": "Delete a label",
    "category": "Labels"
  },
  {
    "method": "GET",
    "path": "/api2/v2/labels/{label_id}",
    "description": "Get a label by ID",
    "category": "Labels"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/labels/{label_id}",
    "description": "Rename a label",
    "category": "Labels",
    "body": "{\"name\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/labels/{label_id}/post/{post_id}",
    "description": "Remove post from label",
    "category": "Labels"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/labels/{label_id}/posts",
    "description": "Remove all posts from label",
    "category": "Labels"
  },
  {
    "method": "POST",
    "path": "/api2/v2/labels/{label_id}/posts",
    "description": "Add posts to label",
    "category": "Labels",
    "body": "{\"posts\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/legal-inquiry",
    "description": "Submit a legal inquiry",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/legal-inquiry/by-counsel",
    "description": "Submit legal inquiry by counsel",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/legal-inquiry/change-status/{inquiry_id}",
    "description": "Change legal inquiry status",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/legal-inquiry/params",
    "description": "✓ Get legal inquiry form params",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/legal-inquiry/send-notification/{inquiry_id}",
    "description": "Send legal inquiry notification",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/legal-inquiry/{inquiry_id}",
    "description": "Get legal inquiry",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/legal-inquiry/{inquiry_id}",
    "description": "Submit legal inquiry response",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/legal-inquiry/{inquiry_id}/history",
    "description": "Get legal inquiry history",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/legal-inquiry/{inquiry_id}/update/{hash}",
    "description": "Get legal inquiry update",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/legal-inquiry/{inquiry_id}/update/{hash}",
    "description": "Update a legal inquiry",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/lists/check/{list_id}/{user_id}",
    "description": "Check list membership",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/sort",
    "description": "Sort user lists",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/users",
    "description": "Add users to lists",
    "category": "Lists"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/lists/{list_id}",
    "description": "Delete a list",
    "category": "Lists"
  },
  {
    "method": "GET",
    "path": "/api2/v2/lists/{list_id}",
    "description": "Get a user list",
    "category": "Lists"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/lists/{list_id}",
    "description": "Update a list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/sort",
    "description": "Sort users in list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/awards/{year}/{month}",
    "description": "Add award-winning users to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/campaign/{campaign_id}/claimers",
    "description": "Add campaign claimers to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/media/{media_id}/buyers",
    "description": "Add media buyers to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/pinned/sort",
    "description": "Sort pinned list users",
    "category": "Lists",
    "body": "{\"order\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/queue/{queue_id}/buyers",
    "description": "Add queue buyers to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/story/{story_id}/{type}",
    "description": "Add story viewers to list",
    "category": "Lists"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/lists/{list_id}/users/stream/{stream_id}/{type}",
    "description": "Remove stream users from list",
    "category": "Lists",
    "body": "{\"tippedOver\": \"\", \"subscribedOver\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/stream/{stream_id}/{type}",
    "description": "Add stream audience to list",
    "category": "Lists",
    "body": "{\"tippedOver\": \"\", \"subscribedOver\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/subscribers",
    "description": "Add subscribers to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/top-subscribers",
    "description": "Add top subscribers to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/{type}/{id}/claims",
    "description": "Add claimers to list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/lists/{list_id}/users/{user_id}/pin",
    "description": "Pin user in list",
    "category": "Lists"
  },
  {
    "method": "POST",
    "path": "/api2/v2/log",
    "description": "Submit client-side log entry",
    "category": "Other",
    "body": "{\"message\": \"\", \"context\": \"\", \"level\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/logins",
    "description": "✓ List login sessions",
    "category": "Auth"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/logins/{login_id}",
    "description": "Revoke a login session",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/messages/queue/chart",
    "description": "✓ Get messages earnings chart",
    "category": "Statistics"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/messages/queue/{queue_id}",
    "description": "Delete queued message",
    "category": "Messages"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/messages/queue/{queue_id}",
    "description": "Update queued message",
    "category": "Messages"
  },
  {
    "method": "POST",
    "path": "/api2/v2/messages/templates/reply_on_subscribe",
    "description": "Set reply-on-subscribe template",
    "category": "Messages"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/messages/templates/{template_id}",
    "description": "Delete message template",
    "category": "Messages"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/messages/{message_id}/hide",
    "description": "Hide a message",
    "category": "Messages"
  },
  {
    "method": "POST",
    "path": "/api2/v2/pages/contacts",
    "description": "Submit contact form",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payments/all/has-transactions",
    "description": "✓ Check if any transactions exist",
    "category": "Payments"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payments/cards",
    "description": "✓ List saved payment cards",
    "category": "Payments"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/payments/cards/{card_id}",
    "description": "Delete a payment card",
    "category": "Payments"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/payments/cards/{card_id}",
    "description": "Update a saved payment card",
    "category": "Payments"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/payments/cards/{card_id}/default",
    "description": "Set default payment card",
    "category": "Payments"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payments/cards/{card_id}/verify",
    "description": "Verify a saved card",
    "category": "Payments"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payments/pay",
    "description": "Submit a payment",
    "category": "Payments"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/payouts/bank",
    "description": "Delete bank payout method",
    "category": "Payouts"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/payouts/bank",
    "description": "Update bank payout details",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/bank",
    "description": "Add payout bank account",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/can-add-vat-documents",
    "description": "✓ Check if VAT documents allowed",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/chargebacks/chart",
    "description": "✓ Get chargebacks statistics chart",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/chart",
    "description": "✓ Get payouts chart stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/check-receive",
    "description": "✓ Check payout receive eligibility",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/dac7",
    "description": "✓ Get DAC7 tax info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/dac7",
    "description": "Submit DAC7 tax information",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/download/vat/{vat_document_id}",
    "description": "Download VAT document",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/legal",
    "description": "Submit payout legal information",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/legal-form",
    "description": "✓ Get payout legal form",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/legal-info",
    "description": "✓ Get payout legal info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/legal/instagram",
    "description": "Submit Instagram legal verification",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/legal/twitter",
    "description": "Submit Twitter legal info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/qst",
    "description": "Submit QST tax information",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/referrals/chart",
    "description": "✓ Get referral earnings chart",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/requests",
    "description": "✓ List payout requests",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/requests/referral",
    "description": "✓ List referral payout requests",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/requests/stripe",
    "description": "✓ List Stripe payout requests",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/requests/vat/{request_id}",
    "description": "Get VAT info for payout request",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/stripe",
    "description": "Get Stripe payout info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/stripe/account",
    "description": "Create or update Stripe payout account",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/stripe/legal",
    "description": "Get Stripe payout legal info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/stripe/legal",
    "description": "Submit Stripe payout legal info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/tax",
    "description": "Submit payout tax info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/tin",
    "description": "Submit taxpayer identification number",
    "category": "Payouts",
    "body": "{\"tin\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/transactions",
    "description": "✓ List payout transactions",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/uk-company-data",
    "description": "Get UK company payout data",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/uk-company-data",
    "description": "Submit UK company payout data",
    "category": "Payouts"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/payouts/vat",
    "description": "Delete VAT number",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/vat",
    "description": "✓ Get payout VAT info",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/vat",
    "description": "Submit VAT number",
    "category": "Payouts",
    "body": "{\"vat\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/vat-requests",
    "description": "Create a VAT request",
    "category": "Payouts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/vat/chart",
    "description": "✓ Get VAT payouts chart stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/payouts/vats",
    "description": "✓ List payout VAT records",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/w9",
    "description": "Submit W-9 tax form",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/w9/address",
    "description": "Submit W-9 address",
    "category": "Payouts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/payouts/w9/tincheck",
    "description": "Verify W9 TIN",
    "category": "Payouts"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/phones/change",
    "description": "Cancel pending phone change",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/phones/change",
    "description": "Request phone number change",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/posts/bookmarks/categories/sort",
    "description": "Sort bookmark categories",
    "category": "Posts"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/posts/bookmarks/categories/{category_id}",
    "description": "Delete a bookmark category",
    "category": "Posts"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/posts/bookmarks/categories/{category_id}",
    "description": "Rename bookmark category",
    "category": "Posts",
    "body": "{\"name\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/posts/bookmarks/categories/{category_id}/{post_id}",
    "description": "Add post to bookmark category",
    "category": "Posts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/posts/chart",
    "description": "✓ Get posts earnings chart",
    "category": "Statistics"
  },
  {
    "method": "POST",
    "path": "/api2/v2/posts/paid/pin/sort",
    "description": "Sort pinned paid posts",
    "category": "Posts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/posts/top",
    "description": "Get top posts stats",
    "category": "Statistics"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/posts/{post_id}/bookmarks",
    "description": "Remove post from bookmarks",
    "category": "Posts",
    "body": "{\"chat_group_id\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/posts/{post_id}/bookmarks",
    "description": "Bookmark a post",
    "category": "Posts",
    "body": "{\"chat_group_id\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/posts/{post_id}/favorites/{author_id}",
    "description": "Add post to favorites",
    "category": "Posts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/posts/{post_id}/fund-raising-contributors/count",
    "description": "Count fundraising contributors",
    "category": "Posts"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/posts/{post_id}/hide",
    "description": "Hide a post",
    "category": "Posts"
  },
  {
    "method": "GET",
    "path": "/api2/v2/promotions",
    "description": "✓ List promotions with stats",
    "category": "Promotions"
  },
  {
    "method": "GET",
    "path": "/api2/v2/promotions/chart",
    "description": "✓ Get promotions statistics chart",
    "category": "Statistics"
  },
  {
    "method": "POST",
    "path": "/api2/v2/promotions/claim",
    "description": "Claim a promotion by code",
    "category": "Promotions",
    "body": "{\"code\": \"\", \"strictAuthCheck\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/promotions/invite",
    "description": "Send promotion invite",
    "category": "Promotions"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/promotions/offer/{offer_id}",
    "description": "Delete a promotion offer",
    "category": "Promotions"
  },
  {
    "method": "GET",
    "path": "/api2/v2/promotions/offer/{offer_id}",
    "description": "Get promotion offer by ID",
    "category": "Promotions"
  },
  {
    "method": "POST",
    "path": "/api2/v2/promotions/offers/hide",
    "description": "Hide promotion offers",
    "category": "Promotions"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/promotions/{promotion_id}",
    "description": "Delete promotion",
    "category": "Promotions"
  },
  {
    "method": "POST",
    "path": "/api2/v2/promotions/{promotion_id}/finish",
    "description": "Finish a promotion",
    "category": "Promotions"
  },
  {
    "method": "POST",
    "path": "/api2/v2/release-form-documents",
    "description": "Upload release form document",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/release-form-links",
    "description": "Create release form link",
    "category": "Media"
  },
  {
    "method": "POST",
    "path": "/api2/v2/release-form-links/{link_id}/start",
    "description": "Start release form link",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/release-form-links/{link_id}/url",
    "description": "Generate release form link URL",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/release-form-proof",
    "description": "Submit release form proof",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/release-forms/attach",
    "description": "Attach release form",
    "category": "Media"
  },
  {
    "method": "GET",
    "path": "/api2/v2/release-forms/partner/{partner_id}",
    "description": "Get partner release forms",
    "category": "Legal"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/release-forms/rename",
    "description": "Rename a release form",
    "category": "Other"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/release-forms/toggle-show",
    "description": "Toggle release form visibility",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/reports/reasons",
    "description": "✓ List content report reasons",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/reports/reasons/{reason_id}/details-options",
    "description": "Get report reason detail options",
    "category": "Other"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/schedules/{schedule_id}/publish",
    "description": "Publish a scheduled item",
    "category": "Posts"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/sessions",
    "description": "Revoke all sessions",
    "category": "Settings"
  },
  {
    "method": "GET",
    "path": "/api2/v2/sessions",
    "description": "✓ List active sessions",
    "category": "Settings"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/shopify/stores/{store_id}",
    "description": "Delete Shopify store",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/stories",
    "description": "Create story",
    "category": "Stories"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/stories/answer/{answer_id}",
    "description": "Delete a story answer",
    "category": "Stories"
  },
  {
    "method": "GET",
    "path": "/api2/v2/stories/chart",
    "description": "✓ Get stories statistics chart",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/stories/top",
    "description": "Get top stories stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/stories/users/blocked",
    "description": "✓ List story-blocked users",
    "category": "Stories"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/stories/users/{user_id}/block",
    "description": "Unblock user from stories",
    "category": "Stories"
  },
  {
    "method": "POST",
    "path": "/api2/v2/stories/users/{user_id}/block",
    "description": "Block user from stories",
    "category": "Stories"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/stories/{story_id}/like",
    "description": "Unlike a story",
    "category": "Stories"
  },
  {
    "method": "POST",
    "path": "/api2/v2/stories/{story_id}/like",
    "description": "Like a story",
    "category": "Stories"
  },
  {
    "method": "GET",
    "path": "/api2/v2/stories/{story_id}/viewers",
    "description": "List story viewers",
    "category": "Stories"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/stories/{story_id}/watched",
    "description": "Mark story as watched",
    "category": "Stories"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streaks",
    "description": "✓ Get streaks over date range",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streaks/top",
    "description": "✓ Get top streaks",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/chart",
    "description": "✓ Get streams stats chart",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/top",
    "description": "Get top streams stats",
    "category": "Statistics"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/users/{user_id}/block",
    "description": "Unblock stream viewer",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/users/{username}/block",
    "description": "Block stream viewer by name",
    "category": "Streams"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}",
    "description": "Delete a stream",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}",
    "description": "Get stream details",
    "category": "Streams"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/streams/{stream_id}",
    "description": "Update a stream",
    "category": "Streams",
    "body": "{\"id\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/accept",
    "description": "Accept dual-stream invite",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}/active",
    "description": "Check if stream active",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/block",
    "description": "Block stream viewer",
    "category": "Streams",
    "body": "{\"userId\": \"\", \"isPermanent\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/cancel",
    "description": "Cancel dual-stream request",
    "category": "Streams"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}/comments/{comment_id}",
    "description": "Delete stream comment",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}/comments/{comment_id}",
    "description": "Get a single stream comment",
    "category": "Streams"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}/comments/{comment_id}/pin",
    "description": "Unpin a stream comment",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/comments/{comment_id}/pin",
    "description": "Pin a stream comment",
    "category": "Streams"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/streams/{stream_id}/cover",
    "description": "Save live stream cover",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}/covers",
    "description": "Fetch stream covers",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/decline",
    "description": "Decline dual-stream invite",
    "category": "Streams"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/streams/{stream_id}/finish",
    "description": "Finish a live stream",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/hide",
    "description": "Hide stream",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}/is-viewer",
    "description": "Check if current user is viewer",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/join",
    "description": "Join a dual stream",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/likes",
    "description": "Add likes to stream",
    "category": "Streams",
    "body": "{\"likes\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}/look",
    "description": "Stop looking at a stream",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/look",
    "description": "Mark viewing a stream",
    "category": "Streams"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/streams/{stream_id}/make-post",
    "description": "Save stream as a post",
    "category": "Streams",
    "body": "{\"id\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}/reminder",
    "description": "Remove stream reminder",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/reminder",
    "description": "Set stream reminder",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/tweet",
    "description": "Share stream to Twitter",
    "category": "Streams",
    "body": "{\"tweetWithPreview\": \"\", \"tweetWithStillPreview\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}/user/{user_id}/comments",
    "description": "Remove a user's stream comments",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/users/{user_id}/accept",
    "description": "Accept dual-stream request",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/users/{user_id}/cancel",
    "description": "Cancel dual-stream invite",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/users/{user_id}/decline",
    "description": "Decline dual-stream request",
    "category": "Streams"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/streams/{stream_id}/users/{user_id}/helper",
    "description": "Remove stream helper",
    "category": "Streams"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/streams/{stream_id}/users/{user_id}/helper",
    "description": "Add stream helper",
    "category": "Streams"
  },
  {
    "method": "POST",
    "path": "/api2/v2/streams/{stream_id}/users/{user_id}/invite",
    "description": "Invite user to dual stream",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}/viewers",
    "description": "List stream viewers",
    "category": "Streams"
  },
  {
    "method": "GET",
    "path": "/api2/v2/streams/{stream_id}/viewers/{user_id}",
    "description": "Get a stream viewer",
    "category": "Streams"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/subscriptions/bundles/{bundle_id}",
    "description": "Delete subscription bundle",
    "category": "Subscriptions"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/subscriptions/bundles/{bundle_id}",
    "description": "Update subscription bundle",
    "category": "Subscriptions"
  },
  {
    "method": "GET",
    "path": "/api2/v2/subscriptions/subscribers",
    "description": "✓ List subscribers",
    "category": "Subscriptions"
  },
  {
    "method": "GET",
    "path": "/api2/v2/subscriptions/subscribers/chart",
    "description": "✓ Get subscribers statistics chart",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/subscriptions/subscribers/latest",
    "description": "✓ Get latest subscribers",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/subscriptions/subscribers/top",
    "description": "✓ Get top subscribers stats",
    "category": "Statistics"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/subscriptions/{subscription_id}",
    "description": "Update a subscription",
    "category": "Subscriptions"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/subscriptions/{subscription_id}/attention",
    "description": "Dismiss subscription attention flag",
    "category": "Subscriptions"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/subscriptions/{subscription_id}/hide-posts",
    "description": "Unhide subscription posts",
    "category": "Subscriptions"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/subscriptions/{subscription_id}/hide-posts",
    "description": "Hide posts from subscription",
    "category": "Subscriptions"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/subscriptions/{subscription_id}/price-change-hint",
    "description": "Dismiss price-change hint",
    "category": "Subscriptions"
  },
  {
    "method": "POST",
    "path": "/api2/v2/texts/search",
    "description": "Search localization texts",
    "category": "Other",
    "body": "{\"code\": \"\", \"languages\": \"\"}"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/texts/{code}",
    "description": "Update a localization text",
    "category": "Other",
    "body": "{\"text\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/trials/chart",
    "description": "✓ Get trials chart stats",
    "category": "Statistics"
  },
  {
    "method": "POST",
    "path": "/api2/v2/trials/check",
    "description": "Check and reserve trial code",
    "category": "Trials",
    "body": "{\"code\": \"\", \"reserve\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/trials/claim",
    "description": "Claim free trial by code",
    "category": "Trials",
    "body": "{\"code\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/trials/share-access",
    "description": "Revoke trial share access",
    "category": "Trials"
  },
  {
    "method": "POST",
    "path": "/api2/v2/trials/share-access",
    "description": "Share trial access",
    "category": "Trials"
  },
  {
    "method": "GET",
    "path": "/api2/v2/trials/stats",
    "description": "✓ Get trial link statistics",
    "category": "Statistics"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/trials/{trial_id}",
    "description": "Delete a trial link",
    "category": "Trials"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/trials/{trial_id}",
    "description": "Update trial link",
    "category": "Trials"
  },
  {
    "method": "POST",
    "path": "/api2/v2/trust",
    "description": "Mark device as trusted",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/unsubscribe/reasons",
    "description": "✓ List unsubscribe reasons",
    "category": "Subscriptions"
  },
  {
    "method": "POST",
    "path": "/api2/v2/upload/signed/create",
    "description": "Create signed media upload",
    "category": "Media"
  },
  {
    "method": "POST",
    "path": "/api2/v2/upload/signed/finish",
    "description": "Finish signed upload",
    "category": "Media"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/alert",
    "description": "✓ Get user alerts",
    "category": "Notifications"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/alert/{alert_id}",
    "description": "Delete user alert",
    "category": "Notifications"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/appeal",
    "description": "Submit account appeal",
    "category": "Users"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/change-password",
    "description": "Change password",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/clicks-stats",
    "description": "Report user click statistics",
    "category": "Statistics"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/connect",
    "description": "Connect a linked account",
    "category": "Users"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/connect/{account_id}",
    "description": "Disconnect a linked account",
    "category": "Users"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/delete/request",
    "description": "Cancel account deletion request",
    "category": "Users"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/delete/request",
    "description": "Request account deletion",
    "category": "Users",
    "body": "{\"captchaCode\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/exists",
    "description": "Check if username exists",
    "category": "Users",
    "body": "{\"username\": \"\"}"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/forgot-password",
    "description": "Request password reset",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/get-auth-token",
    "description": "Get auth token",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/get-otp-token",
    "description": "Get OTP token",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/helper-logout",
    "description": "Log out helper session",
    "category": "Auth"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/hints/{hint_id}",
    "description": "Dismiss user hint",
    "category": "Users"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/license_form",
    "description": "Submit license form",
    "category": "Legal"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/links",
    "description": "✓ Get user links",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/links",
    "description": "Add profile link",
    "category": "Profile"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/links",
    "description": "Update a user link",
    "category": "Profile",
    "body": "{\"link\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/links/{link_id}",
    "description": "Delete a user link",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/login",
    "description": "Log in user",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/login-as-helper/{helper_id}",
    "description": "Log in as a helper",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/logout",
    "description": "Log out current user",
    "category": "Auth"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/mass-alert/{alert_id}",
    "description": "Dismiss a mass alert",
    "category": "Notifications"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/mass-hints/{hint_id}",
    "description": "Delete mass message hint",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/auth-token",
    "description": "✓ Get current auth token",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/id",
    "description": "✓ Get current user ID",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/referrals",
    "description": "✓ List referrals",
    "category": "Statistics"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/users/me/settings/messages",
    "description": "Update message settings",
    "category": "Settings"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/me/settings/{section}",
    "description": "Update user settings section",
    "category": "Settings"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/users/me/settings/{settings_section}",
    "description": "Update user settings section",
    "category": "Settings"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/start-date-model",
    "description": "✓ Get creator start date",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/stats/messages/{type}",
    "description": "Get messages statistics by type",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/stats/top/fan",
    "description": "✓ Get top fans stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/stats/top/message",
    "description": "✓ Get top messages stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/stats/top/post",
    "description": "✓ Get top posts statistics",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/stats/top/story",
    "description": "✓ Get top stories stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/stats/top/stream",
    "description": "✓ Get top streams stats",
    "category": "Statistics"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/me/strong_otp_codes",
    "description": "Get OTP backup codes",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/me/validate-data",
    "description": "Validate current user data",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/media/drm/certificate",
    "description": "✓ Get DRM certificate",
    "category": "Media"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/notifications/settings/tabs-order",
    "description": "✓ Get notification tabs order",
    "category": "Notifications"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/notifications/settings/tabs-order",
    "description": "Save notification tabs order",
    "category": "Notifications"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/notifications/{notification_id}/read",
    "description": "Mark notification as read",
    "category": "Notifications"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/opensea/nft",
    "description": "Set OpenSea NFT profile item",
    "category": "Profile"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/opensea/wallet",
    "description": "Disconnect OpenSea wallet",
    "category": "Users"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/opensea/wallet",
    "description": "Connect OpenSea wallet",
    "category": "Users"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/otp",
    "description": "Disable two-factor OTP",
    "category": "Auth",
    "body": "{\"code\": \"\"}"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/otp",
    "description": "Confirm OTP code",
    "category": "Auth",
    "body": "{\"code\": \"\"}"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/otp/alternative",
    "description": "Request alternative OTP method",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/otp/check",
    "description": "Verify OTP code",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/otp/code",
    "description": "Request OTP code",
    "category": "Auth"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/otp/phone",
    "description": "Enable phone OTP",
    "category": "Auth"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/password",
    "description": "Remove account password",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/posts/on-this-day",
    "description": "✓ Get 'on this day' posts",
    "category": "Posts"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/profile/view",
    "description": "Record profile view",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/profile/visit",
    "description": "Record a profile visit",
    "category": "Profile"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/promotions",
    "description": "✓ Get user promotions",
    "category": "Promotions"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/push-token/pwa",
    "description": "Register PWA push token",
    "category": "Notifications"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/recommends/{user_id}",
    "description": "Dismiss a recommended user",
    "category": "Users"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/register",
    "description": "Register a new user account",
    "category": "Auth"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/restore-access",
    "description": "Restore account access with code",
    "category": "Users",
    "body": "{\"code\": \"\"}"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/users/settings/notifications",
    "description": "Update notification settings",
    "category": "Settings"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/settings/notifications/transports",
    "description": "✓ Get notification transport settings",
    "category": "Settings"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/social/buttons",
    "description": "✓ Get social buttons",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/social/buttons",
    "description": "Add social buttons",
    "category": "Profile",
    "body": "{\"buttonIds\": \"\"}"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/social/buttons",
    "description": "Update social profile buttons",
    "category": "Profile"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/social/buttons/{button_id}",
    "description": "Delete a social button",
    "category": "Profile"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/social/buttons/{button_id}",
    "description": "Update a social button",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/social/buttons/{button_id}/click",
    "description": "Register social button click",
    "category": "Profile"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/social/spotify/anthem",
    "description": "Set Spotify anthem",
    "category": "Profile",
    "body": "{\"anthemId\": \"\"}"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/social/spotify/artists",
    "description": "Set top Spotify artists",
    "category": "Profile",
    "body": "{\"topArtistsIds\": \"\"}"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/social/spring",
    "description": "Disconnect Spring integration",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/social/spring",
    "description": "Connect Spring merch account",
    "category": "Profile"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/users/social/{network}",
    "description": "Disconnect social network",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/switch/{user_id}",
    "description": "Switch to connected account",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/telegram-link",
    "description": "Get Telegram link info",
    "category": "Settings"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/terms/confirm",
    "description": "Confirm terms acceptance",
    "category": "Legal"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/tickets",
    "description": "Create a support ticket",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/tickets/allowed",
    "description": "Check support ticket allowed",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/tickets/form_subjects",
    "description": "✓ Get support ticket subjects",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/tickets/{ticket_id}",
    "description": "Get support ticket",
    "category": "Other"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/tickets/{ticket_id}/read",
    "description": "Mark support ticket as read",
    "category": "Other"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/users/tickets/{ticket_id}/reopen",
    "description": "Reopen a support ticket",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/tickets/{ticket_id}/reply",
    "description": "Reply to support ticket",
    "category": "Other"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/tickets/{ticket_id}/solve",
    "description": "Mark support ticket solved",
    "category": "Other"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/ws-auth",
    "description": "✓ Get WebSocket auth token",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/{user_id}/friends/pinned",
    "description": "Get pinned friends",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/{user_id}/links",
    "description": "Get user's links",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/users/{user_id}/resubscribe",
    "description": "Resubscribe to a user",
    "category": "Subscriptions"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/{user_id}/shopify/stores",
    "description": "List user's Shopify stores",
    "category": "Users"
  },
  {
    "method": "GET",
    "path": "/api2/v2/users/{user_id}/social/buttons",
    "description": "Get user social buttons",
    "category": "Profile"
  },
  {
    "method": "POST",
    "path": "/api2/v2/vault/lists/sort",
    "description": "Sort vault lists",
    "category": "Vault"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/vault/lists/{list_id}",
    "description": "Delete vault list",
    "category": "Vault",
    "body": "{\"clearMedia\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/vault/lists/{list_id}",
    "description": "Get vault media list",
    "category": "Vault"
  },
  {
    "method": "PATCH",
    "path": "/api2/v2/vault/lists/{list_id}",
    "description": "Rename a vault list",
    "category": "Vault",
    "body": "{\"name\": \"\"}"
  },
  {
    "method": "PUT",
    "path": "/api2/v2/vault/media/hidden",
    "description": "Hide vault media",
    "category": "Vault",
    "body": "{\"mediaIds\": \"\"}"
  },
  {
    "method": "GET",
    "path": "/api2/v2/vault/media/{media_id}/release-forms",
    "description": "Get vault media release forms",
    "category": "Vault"
  },
  {
    "method": "DELETE",
    "path": "/api2/v2/webauthn/credentials",
    "description": "Delete a WebAuthn credential",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/webauthn/credentials",
    "description": "✓ List WebAuthn credentials",
    "category": "Auth"
  },
  {
    "method": "GET",
    "path": "/api2/v2/zip/{zip_code}/state",
    "description": "Get state for a ZIP code",
    "category": "Other"
  }
];
