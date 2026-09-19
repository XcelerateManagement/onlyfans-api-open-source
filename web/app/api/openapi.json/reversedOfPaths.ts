// AUTO-GENERATED — reverse-engineered OnlyFans /api2/v2 endpoints.
// Source: OnlyFans web client build, statically extracted. Do not hand-edit.
export const reversedOfPaths = {
  "/api2/v2/accepted-cookies": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Record cookie consent",
      "description": "Stores the user's accepted cookie/consent preferences. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible (cookie consent payload)"
      }
    }
  },
  "/api2/v2/address": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Save address",
      "description": "Submits/saves an address for the user; appears alongside payout/Stripe and country endpoints, suggesting a payout or billing address. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; address fields not statically visible"
      }
    }
  },
  "/api2/v2/address/stat": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Record address statistics",
      "description": "Posts address-related statistics data. Appears alongside GDPR, clicks-stats and accepted-cookies analytics calls. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/age-verifier/start": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Start age verification",
      "description": "Initiates the age verification flow. Grouped with iv/start and face-id/start identity checks. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/alternative-payment-methods": {
    "delete": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Delete alternative payment method",
      "description": "Removes a saved alternative payment method, identified by id in the request body. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List alternative payment methods",
      "description": "Returns the available alternative (non-card) payment methods for the user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/alternative-payment-methods/form": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit alternative payment method form",
      "description": "Submits the form for an alternative payment method. A GET on the same path retrieves the form definition. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/alternative-payment-methods/pay": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Pay via alternative method",
      "description": "Submits a payment through an alternative payment method (e.g. PayPal). Related GET/POST endpoints handle the alternative-payment-methods form and listing. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; payment fields not statically visible"
      }
    }
  },
  "/api2/v2/alternative-payment-methods/paypal": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get PayPal payment method info",
      "description": "Returns the current PayPal alternative payment method configuration/status for the user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "paypalStatus": {
                        "type": "array"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/av/email-check": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Check account email",
      "description": "Triggers an email check for the account (av module). Called with no arguments. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/campaigns/transition": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Transition a campaign state",
      "description": "Transitions a promotional campaign to a new state/status. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; transition fields not statically visible"
      }
    }
  },
  "/api2/v2/campaigns/{campaign_id}": {
    "delete": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Delete campaign",
      "description": "Deletes a promotional campaign by id. Grouped with campaign share-access, claimers and trials endpoints. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "campaign_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the campaign to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/chats/mark-as-read": {
    "post": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Mark chats as read",
      "description": "Marks one or more chats as read for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely chat/user ids, not statically visible"
      }
    }
  },
  "/api2/v2/chats/{user_id}/messages/{message_id}": {
    "get": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Get single chat message",
      "description": "Retrieves a specific message within the chat with a given user. Called as getMessage({userId, groupId}). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user the chat is with"
        },
        {
          "name": "message_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the message (passed as groupId in the caller)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/comments/{comment_id}": {
    "delete": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Delete a comment",
      "description": "Deletes a specific comment by its id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the comment to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/comments/{comment_id}/like": {
    "delete": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Unlike a comment",
      "description": "Removes the current user's like from a comment (POST on the same path adds a like). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the comment to unlike"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Like a comment",
      "description": "Adds a like to the specified comment. Paired with a DELETE on the same path to unlike, plus comment pin/delete calls. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the comment to like"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/comments/{comment_id}/pin": {
    "delete": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Unpin a comment",
      "description": "Removes the pinned status from a comment. The paired POST /comments/{id}/pin pins it. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the comment to unpin"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Pin a comment",
      "description": "Pins the specified comment. Paired with a DELETE on the same path to unpin. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the comment to pin"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/consent-form": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit consent form",
      "description": "Submits/creates a consent form. Grouped with release-form and release-form-proof endpoints for content compliance. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/countries/payouts": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List payout-supported countries",
      "description": "Returns the list of countries supported/available for creator payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "integer"
                        },
                        "code": {
                          "type": "string"
                        },
                        "name": {
                          "type": "string"
                        },
                        "hasStates": {
                          "type": "boolean"
                        },
                        "hasZip": {
                          "type": "boolean"
                        },
                        "canPay": {
                          "type": "boolean"
                        },
                        "canHasW9Form": {
                          "type": "boolean"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/countries/{country_id}/address/expand": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Expand address for country",
      "description": "Expands/resolves a partial address (by its hash) for a given country, optionally in Latin transliteration. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "country_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the country for address expansion"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "hash": {
                  "type": "string",
                  "description": "Address identifier/hash to expand (addressId)"
                },
                "isLatin": {
                  "type": "boolean",
                  "description": "Whether to return Latin-script address"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/countries/{country_id}/states": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "List states for a country",
      "description": "Returns the list of states/regions for the specified country. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "country_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the country whose states are requested"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/earnings/chart": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get earnings chart data",
      "description": "Returns earnings chart/time-series data for a date range, optionally filtered and including totals. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals (set to true by the client)"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Earnings breakdown filter (e.g. subscribes/tips amounts)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/emails/change": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Cancel pending email change",
      "description": "Cancels a pending email-change request (POST on the same path initiates one). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Request email address change",
      "description": "Initiates a change of the account's email address. A DELETE on the same path cancels a pending change. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/emails/resend": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Resend confirmation email",
      "description": "Resends the account confirmation/verification email. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/face-id/postpone": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Postpone face-ID verification",
      "description": "Postpones the required Face ID identity verification step. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/face-id/start": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Start Face ID verification",
      "description": "Starts a Face ID (biometric identity) verification session. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (optional, defaults to {})"
      }
    }
  },
  "/api2/v2/guests/{guest_id}": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get guest details",
      "description": "Retrieves a guest record by id. Guests appear alongside release-form and guest-assign endpoints (people tagged in content). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "guest_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the guest"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/guests/{guest_id}/assign": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Assign a guest",
      "description": "Assigns a guest (co-performer/guest record) identified by guest_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "guest_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the guest to assign"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/helpers/{helper_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Remove account helper",
      "description": "Removes a helper (delegated team member) from the account. Related calls manage helper permissions and login-as-helper. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "helper_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "User ID of the helper to remove"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/helpers/{user_id}": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Add or update account helper",
      "description": "Grants or updates an account helper (team member) identified by user_id, assigning the given permission set. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "User id of the helper being granted permissions"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "permissions": {
                  "type": "array",
                  "description": "List of permission keys to grant the helper (defaults to empty array)"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/ip": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get client IP address",
      "description": "Returns the caller's IP address as seen by the API. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "ip": {
                        "type": "string"
                      },
                      "geo": {
                        "type": "object",
                        "properties": {
                          "connectionType": {
                            "type": "string"
                          },
                          "userType": {
                            "type": "string"
                          },
                          "subdivisionConfidence": {
                            "type": "string"
                          },
                          "postalConfidence": {
                            "type": "string"
                          },
                          "isp": {
                            "type": "string"
                          },
                          "domain": {
                            "type": "string"
                          },
                          "countryConfidence": {
                            "type": "string"
                          },
                          "cityConfidence": {
                            "type": "string"
                          },
                          "legitimateProxy": {
                            "type": "string"
                          },
                          "regionName": {
                            "type": "string"
                          },
                          "region": {
                            "type": "string"
                          },
                          "regionGeonameid": {
                            "type": "string"
                          },
                          "registeredCountryInEu": {
                            "type": "string"
                          },
                          "registeredCountryName": {
                            "type": "string"
                          },
                          "registeredCountryIso": {
                            "type": "string"
                          },
                          "registeredCountryGeonameid": {
                            "type": "string"
                          },
                          "postalCode": {
                            "type": "string"
                          },
                          "locationTimezone": {
                            "type": "string"
                          },
                          "locationMetrocode": {
                            "type": "string"
                          },
                          "longitude": {
                            "type": "string"
                          },
                          "latitude": {
                            "type": "string"
                          },
                          "locationAccuracyRadius": {
                            "type": "string"
                          },
                          "countryInEu": {
                            "type": "string"
                          },
                          "countryName": {
                            "type": "string"
                          },
                          "countryCode": {
                            "type": "string"
                          },
                          "countryGeonameid": {
                            "type": "string"
                          },
                          "continentName": {
                            "type": "string"
                          },
                          "continentGeonameid": {
                            "type": "string"
                          },
                          "continentCode": {
                            "type": "string"
                          },
                          "cityGeonameid": {
                            "type": "string"
                          },
                          "city": {
                            "type": "string"
                          },
                          "cityBuildDate": {
                            "type": "string"
                          }
                        }
                      },
                      "isEurope": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/iso/countries/{country_id}/states": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "List states for country",
      "description": "Returns the ISO list of states/regions for a given country. Reference/lookup data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "country_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the country"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/issues/login": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Report login issue",
      "description": "Submits a login issue report (support). Called with an optional payload object. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/iv/start": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Start identity verification",
      "description": "Starts an identity-verification (IV) flow for the user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (defaults to {}); fields not statically visible"
      }
    }
  },
  "/api2/v2/iv/yoti-face-id-url/{id}/{token}": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get Yoti face-ID verification URL",
      "description": "Returns a Yoti face-ID identity-verification URL for the given identifiers. Part of the /iv identity-verification module (also yoti-redirect-url). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "First path identifier (uncertain; likely verification/session id)"
        },
        {
          "name": "token",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Second path identifier (uncertain; likely a token/type/hash)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/iv/yoti-redirect-url/{verification_id}": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get Yoti identity verification URL",
      "description": "Retrieves a Yoti identity-verification redirect URL for the identity verification (iv) flow. Sibling call fetches a Yoti face-ID URL. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "verification_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Identifier for the Yoti identity verification session (exact meaning uncertain)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/labels/sort": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Sort labels",
      "description": "Reorders the user's labels according to the supplied order. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely an ordered list of label ids"
      }
    }
  },
  "/api2/v2/labels/{label_id}": {
    "delete": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Delete a label",
      "description": "Deletes a label identified by label id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "label_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the label to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Get a label by ID",
      "description": "Retrieves a single content label by its ID. Sibling calls create, rename, sort and delete labels. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "label_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the label to retrieve"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "patch": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Rename a label",
      "description": "Renames the label identified by label_id to the provided name. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "label_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the label to rename"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "New label name"
                }
              }
            }
          }
        },
        "description": "Payload is {name: t}"
      }
    }
  },
  "/api2/v2/labels/{label_id}/post/{post_id}": {
    "delete": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Remove post from label",
      "description": "Removes a single post from the specified label. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "label_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the label"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the post to remove from the label"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/labels/{label_id}/posts": {
    "delete": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Remove all posts from label",
      "description": "Removes all posts from the specified label. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "label_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the label to clear"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add posts to label",
      "description": "Adds one or more posts to a label. Called as (labelId, posts[]). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "label_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the label"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "posts": {
                  "type": "array",
                  "description": "IDs of the posts to add to the label"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/legal-inquiry": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit a legal inquiry",
      "description": "Creates/submits a new legal inquiry (takedown/legal request). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; legal inquiry submission payload"
      }
    }
  },
  "/api2/v2/legal-inquiry/by-counsel": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit legal inquiry by counsel",
      "description": "Submits a legal inquiry on behalf of legal counsel. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; inquiry fields not statically visible"
      }
    }
  },
  "/api2/v2/legal-inquiry/change-status/{inquiry_id}": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Change legal inquiry status",
      "description": "Changes the status of a legal inquiry. Part of the legal-inquiry (static-law) module. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (status data); fields not statically visible"
      }
    }
  },
  "/api2/v2/legal-inquiry/params": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get legal inquiry form params",
      "description": "Returns the parameter/option definitions used to build the legal inquiry form. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "newReportsCount": {
                        "type": "integer"
                      },
                      "fileAllowedExtensions": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "legalInquiry": {
                        "type": "object",
                        "properties": {
                          "matterTypes": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "additional": {
                        "type": "object",
                        "properties": {
                          "category": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "subject": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "gdprOptions": {
                        "type": "object",
                        "properties": {
                          "groups": {
                            "type": "object",
                            "properties": {
                              "sdt-group": {
                                "type": "object"
                              },
                              "sw-group": {
                                "type": "object"
                              },
                              "content-group": {
                                "type": "object"
                              },
                              "no-content-group": {
                                "type": "object"
                              },
                              "civil_subpoena-group": {
                                "type": "object"
                              }
                            }
                          },
                          "reports": {
                            "type": "object",
                            "properties": {
                              "personal_data": {
                                "type": "object"
                              },
                              "payment_billing": {
                                "type": "object"
                              },
                              "access_links": {
                                "type": "object"
                              },
                              "correspondence": {
                                "type": "object"
                              },
                              "posts_deleted_posts": {
                                "type": "object"
                              },
                              "vaults": {
                                "type": "object"
                              },
                              "audit": {
                                "type": "object"
                              }
                            }
                          }
                        }
                      },
                      "highPrioritySubjects": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      },
                      "success": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/legal-inquiry/send-notification/{inquiry_id}": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Send legal inquiry notification",
      "description": "Sends a notification for the specified legal inquiry. No request body is sent. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/legal-inquiry/{inquiry_id}": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get legal inquiry",
      "description": "Retrieves a legal inquiry (e.g. legal/DMCA request) by ID. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit legal inquiry response",
      "description": "Submits data/response for a specific legal inquiry. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque `data` object; fields not statically visible"
      }
    }
  },
  "/api2/v2/legal-inquiry/{inquiry_id}/history": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get legal inquiry history",
      "description": "Returns the history/audit trail for a legal inquiry by id (from the legal/law module). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/legal-inquiry/{inquiry_id}/update/{hash}": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get legal inquiry update",
      "description": "Retrieves a specific update of a legal inquiry identified by inquiry_id, addressed by an update hash. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        },
        {
          "name": "hash",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Hash identifying the specific inquiry update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Update a legal inquiry",
      "description": "Submits an update to a legal inquiry identified by its ID and hash. Part of the legal-inquiry module (search, history, change-status). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "inquiry_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the legal inquiry"
        },
        {
          "name": "hash",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Update hash/token authorizing the update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (caller 'data'); fields not statically visible"
      }
    }
  },
  "/api2/v2/lists/check/{list_id}/{user_id}": {
    "get": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Check list membership",
      "description": "Checks whether a given user belongs to a specific list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user to check"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/sort": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Sort user lists",
      "description": "Persists a new ordering of the user's lists. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (ordering payload); fields not statically visible"
      }
    }
  },
  "/api2/v2/lists/users": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add users to lists",
      "description": "Adds users to one or more lists in bulk. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely userIds + listIds, not statically visible"
      }
    }
  },
  "/api2/v2/lists/{list_id}": {
    "delete": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Delete a list",
      "description": "Deletes a user list by id (GET retrieves it, PATCH renames/updates it). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Get a user list",
      "description": "Retrieves a single user list identified by list_id. Enclosing fn is getUsersList. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list to retrieve"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "patch": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Update a list",
      "description": "Updates the given user list (getUsersList/updateList module). Sibling calls create, delete and sort lists. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list to update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (caller 'data'); fields not statically visible"
      }
    }
  },
  "/api2/v2/lists/{list_id}/sort": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Sort users in list",
      "description": "Sorts the users within a list. Called as sortListUsers({listId, data}). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (sort data); fields not statically visible"
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/awards/{year}/{month}": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add award-winning users to list",
      "description": "Adds users who received awards in the given year/month to the specified list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list"
        },
        {
          "name": "year",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Year of the awards period"
        },
        {
          "name": "month",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Month of the awards period"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/campaign/{campaign_id}/claimers": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add campaign claimers to list",
      "description": "Adds the users who claimed a campaign to a custom list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list"
        },
        {
          "name": "campaign_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the campaign whose claimers are added"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/media/{media_id}/buyers": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add media buyers to list",
      "description": "Adds users who purchased a given media item to a list (bulk add by media). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the target list"
        },
        {
          "name": "media_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the media whose buyers are added"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/pinned/sort": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Sort pinned list users",
      "description": "Reorders the pinned users within a list identified by list_id, per the provided order. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list whose pinned users are sorted"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "order": {
                  "type": "array",
                  "description": "Desired ordering of pinned user IDs"
                }
              }
            }
          }
        },
        "description": "Payload is {order: t}"
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/queue/{queue_id}/buyers": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add queue buyers to list",
      "description": "Adds users who bought from a given queue to a list (bulk add by queue). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the target list"
        },
        {
          "name": "queue_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the queue whose buyers are added"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/story/{story_id}/{type}": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add story viewers to list",
      "description": "Adds users who interacted with a given story (by interaction type) to the specified list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the target list"
        },
        {
          "name": "story_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the story"
        },
        {
          "name": "type",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Interaction type used to select users"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/stream/{stream_id}/{type}": {
    "delete": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Remove stream users from list",
      "description": "Removes stream-derived users (e.g. viewers who tipped or subscribed over a threshold) of a given type from a list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "type",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "User selection type (passed as the trailing path segment)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add stream audience to list",
      "description": "Adds users from a live stream (matching the given type/criteria) to a list, optionally filtered by tip/subscription thresholds. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the target list"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the stream whose audience is added"
        },
        {
          "name": "type",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Audience segment/type key (e.g. viewers/tippers)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "tippedOver": {
                  "type": "number",
                  "description": "Only include users who tipped over this amount"
                },
                "subscribedOver": {
                  "type": "number",
                  "description": "Only include users subscribed over this threshold"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/subscribers": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add subscribers to list",
      "description": "Adds subscribers to the list identified by list_id. Enclosing fn is addSubscribersToList. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list to add subscribers to"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (rest of args); fields not statically visible"
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/top-subscribers": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add top subscribers to list",
      "description": "Adds the account's top subscribers to the given list (addTopSubscribersToList). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list to add top subscribers to"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; spread of caller-provided fields, not statically visible"
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/{type}/{id}/claims": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Add claimers to list",
      "description": "Adds users who claimed a given entity (identified by type and id) to the specified list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the target list"
        },
        {
          "name": "type",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Claim entity type"
        },
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the entity of the given type"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/lists/{list_id}/users/{user_id}/pin": {
    "post": {
      "tags": [
        "OF API — Lists"
      ],
      "summary": "Pin user in list",
      "description": "Pins a user to the top of a custom list. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the list"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user to pin"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/log": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit client-side log entry",
      "description": "Sends a client log message with optional context data, logger name and level to the server-side logging endpoint. The context is wrapped with an `onlyfans.<logger>` logger name and a timestamp. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "message": {
                  "type": "string",
                  "description": "Log message text"
                },
                "context": {
                  "type": "object",
                  "description": "Arbitrary log data merged with logger name and timestamp"
                },
                "level": {
                  "type": "string",
                  "description": "Log level, e.g. debug/info/error"
                }
              }
            }
          }
        },
        "description": "Wrapper helpers force level to 'debug'"
      }
    }
  },
  "/api2/v2/logins": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "List login sessions",
      "description": "Returns the account's login sessions/history. Paired with DELETE /logins/{id} to revoke a session. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "login": {
                              "type": "string"
                            },
                            "date": {
                              "type": "string"
                            },
                            "isPersistent": {
                              "type": "boolean"
                            }
                          }
                        }
                      },
                      "hasMore": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/logins/{login_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Revoke a login session",
      "description": "Revokes/removes an active login session identified by login id. Paired with GET /logins which lists active sessions. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "login_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the login/session to revoke"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/messages/queue/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get messages earnings chart",
      "description": "Returns time-series earnings/statistics for queued messages. The dynamic path segment is a built querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals in the response"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Metric filter (built from 'by' and 'by2' arguments)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "purchases": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "messages": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/messages/queue/{queue_id}": {
    "delete": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Delete queued message",
      "description": "Deletes a queued (scheduled) mass message by its queue ID. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "queue_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the queued/scheduled message"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Update queued message",
      "description": "Updates a queued/scheduled message identified by its queue id with new message data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "queue_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the queued/scheduled message"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; scheduled message payload passed as first argument"
      }
    }
  },
  "/api2/v2/messages/templates/reply_on_subscribe": {
    "post": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Set reply-on-subscribe template",
      "description": "Creates or updates the automatic welcome message template sent when a fan subscribes. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; template payload not statically visible"
      }
    }
  },
  "/api2/v2/messages/templates/{template_id}": {
    "delete": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Delete message template",
      "description": "Deletes a saved message template. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "template_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the message template to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/messages/{message_id}/hide": {
    "put": {
      "tags": [
        "OF API — Messaging"
      ],
      "summary": "Hide a message",
      "description": "Hides a chat message identified by message_id. The request body carries hide options. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "message_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the message to hide"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (2nd arg); fields not statically visible"
      }
    }
  },
  "/api2/v2/pages/contacts": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit contact form",
      "description": "Submits the contact page form data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; contact form fields"
      }
    }
  },
  "/api2/v2/payments/all/has-transactions": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Check if any transactions exist",
      "description": "Returns whether the account has any payment transactions across all payment sources. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "hasTransactions": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payments/cards": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List saved payment cards",
      "description": "Returns the fan's saved payment cards. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payments/cards/{card_id}": {
    "delete": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Delete a payment card",
      "description": "Removes a saved payment card from the user's account. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "card_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the saved payment card to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Update a saved payment card",
      "description": "Updates the details of a saved payment card identified by card_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "card_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the saved payment card to update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (card fields); not statically visible"
      }
    }
  },
  "/api2/v2/payments/cards/{card_id}/default": {
    "put": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Set default payment card",
      "description": "Marks the specified saved payment card as the account's default card. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "card_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the saved payment card"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payments/cards/{card_id}/verify": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Verify a saved card",
      "description": "Verifies a stored payment card identified by card id, optionally with verification data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "card_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the saved payment card"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (optional, defaults to {}); verification data"
      }
    }
  },
  "/api2/v2/payments/pay": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit a payment",
      "description": "Processes/submits a payment. Part of the payments module alongside 3ds-js and cards endpoints. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; payment fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/bank": {
    "delete": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Delete bank payout method",
      "description": "Removes the creator's configured bank account used for payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "patch": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Update bank payout details",
      "description": "Partially updates the creator's bank account details used for payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; bank detail fields not statically visible"
      }
    },
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Add payout bank account",
      "description": "Creates/saves a bank account for payouts. GET on the same path retrieves the current bank details. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; bank account fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/can-add-vat-documents": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Check if VAT documents allowed",
      "description": "Returns whether the creator is currently allowed to add VAT documents to their payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "success": {
                        "type": "boolean"
                      },
                      "errorMessage": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/chargebacks/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get chargebacks statistics chart",
      "description": "Returns chart/statistics data for payout chargebacks over a date range, with totals and amount/count breakdown. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals (defaults true)"
        },
        {
          "name": "withChart",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include chart series (set true)"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Chart filter (chartAmount/chartCount)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get payouts chart stats",
      "description": "Returns payouts chart statistics (amount/count) over a date range. The dynamic path segment is the serialized querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals (set true)"
        },
        {
          "name": "withChart",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include chart series (set true)"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Chart amount/count filter"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/check-receive": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Check payout receive eligibility",
      "description": "Checks whether the creator is able to receive payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "isVerifiedReason": {
                        "type": "boolean"
                      },
                      "canReceiveManualPayout": {
                        "type": "boolean"
                      },
                      "needUpdateBanking": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/dac7": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get DAC7 tax info",
      "description": "Retrieves the creator's stored DAC7 (EU platform reporting) tax information for payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "status": {
                        "type": "string"
                      },
                      "type": {
                        "type": "string"
                      },
                      "firstName": {
                        "type": "string"
                      },
                      "lastName": {
                        "type": "string"
                      },
                      "address": {
                        "type": "string"
                      },
                      "city": {
                        "type": "string"
                      },
                      "state": {
                        "type": "string"
                      },
                      "zip": {
                        "type": "string"
                      },
                      "countryId": {
                        "type": "integer"
                      },
                      "taxId": {
                        "type": "string"
                      },
                      "issuingCountryId": {
                        "type": "integer"
                      },
                      "vatNumber": {
                        "type": "string"
                      },
                      "DOB": {
                        "type": "string"
                      },
                      "cityOfBirth": {
                        "type": "string"
                      },
                      "countryOfBirthId": {
                        "type": "integer"
                      },
                      "countryOfResidenceId": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit DAC7 tax information",
      "description": "Submits the creator's DAC7 (EU tax reporting) information. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque payload object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/download/vat/{vat_document_id}": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Download VAT document",
      "description": "Downloads a specific VAT document/invoice for payouts by its id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "vat_document_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the VAT document to download"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/legal": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit payout legal information",
      "description": "Submits the creator's legal/identity information required for payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque payload object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/legal-form": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get payout legal form",
      "description": "Retrieves the legal form data required for payouts (tax/identity legal form). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "realFirstName": {
                        "type": "string"
                      },
                      "realLastName": {
                        "type": "string"
                      },
                      "realBusinessName": {
                        "type": "string"
                      },
                      "realAddress": {
                        "type": "string"
                      },
                      "realCity": {
                        "type": "string"
                      },
                      "realState": {
                        "type": "string"
                      },
                      "realPostal": {
                        "type": "string"
                      },
                      "realTwitter": {
                        "type": "null"
                      },
                      "realInstagram": {
                        "type": "string"
                      },
                      "privateWebsite": {
                        "type": "null"
                      },
                      "dateOfBirth": {
                        "type": "string"
                      },
                      "documentType": {
                        "type": "object",
                        "properties": {
                          "values": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "isAllowedDL": {
                        "type": "boolean"
                      },
                      "isAllowedCustomW9Address": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/legal-info": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get payout legal info",
      "description": "Retrieves the creator's payout legal information. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "isXXX": {
                        "type": "boolean"
                      },
                      "isW9Required": {
                        "type": "boolean"
                      },
                      "isW9Exist": {
                        "type": "boolean"
                      },
                      "isRealIdImage": {
                        "type": "boolean"
                      },
                      "canChangePayoutType": {
                        "type": "boolean"
                      },
                      "ivStatus": {
                        "type": "string"
                      },
                      "ivFailReason": {
                        "type": "null"
                      },
                      "showIvButton": {
                        "type": "boolean"
                      },
                      "canShowLegalForm": {
                        "type": "boolean"
                      },
                      "payoutLegalApproveRejectReason": {
                        "type": "null"
                      },
                      "hideBanking": {
                        "type": "boolean"
                      },
                      "isCompany": {
                        "type": "boolean"
                      },
                      "DAC7": {
                        "type": "object",
                        "properties": {
                          "required": {
                            "type": "boolean"
                          },
                          "type": {
                            "type": "string"
                          },
                          "state": {
                            "type": "string"
                          },
                          "error": {
                            "type": "null"
                          },
                          "countryIds": {
                            "type": "array",
                            "items": {
                              "type": "integer"
                            }
                          }
                        }
                      },
                      "DPR": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/legal/instagram": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit Instagram legal verification",
      "description": "Submits legal/identity verification information via an Instagram account for payouts. Sibling of payouts/legal and payouts/legal/twitter. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/legal/twitter": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit Twitter legal info",
      "description": "Submits Twitter/X account legal verification information for the payouts legal flow. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/qst": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit QST tax information",
      "description": "Submits the creator's QST (Quebec sales tax) information. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque payload object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/referrals/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get referral earnings chart",
      "description": "Returns chart data for referral payouts over a date range with totals. The dynamic suffix in path_raw is the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals, default 1"
        },
        {
          "name": "withChart",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include chart series, sent true"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Chart filter (chartAmount/chartCount)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/requests": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List payout requests",
      "description": "Returns the creator's payout (withdrawal) requests within a date range, paginated. The dynamic path segment is actually the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "marker",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination marker/cursor"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "list": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "invoiceId": {
                              "type": "string"
                            },
                            "createdAt": {
                              "type": "string"
                            },
                            "amount": {
                              "type": "integer"
                            },
                            "currency": {
                              "type": "string"
                            },
                            "state": {
                              "type": "string"
                            },
                            "rejectReason": {
                              "type": "null"
                            }
                          }
                        }
                      },
                      "marker": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/requests/referral": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List referral payout requests",
      "description": "Retrieves referral payout requests over a date range with pagination. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of date range"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "marker",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination marker/cursor"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "list": {
                        "type": "array"
                      },
                      "marker": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/requests/stripe": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List Stripe payout requests",
      "description": "Returns the creator's Stripe payout requests, paginated by lastPayoutId. The dynamic path segment is actually the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Max number of results"
        },
        {
          "name": "lastPayoutId",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Cursor: return requests after this payout ID"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "list": {
                        "type": "array"
                      },
                      "marker": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/requests/vat/{request_id}": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get VAT info for payout request",
      "description": "Returns VAT details associated with a specific payout request. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "request_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the payout/VAT request"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/stripe": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get Stripe payout info",
      "description": "Retrieves the creator's Stripe payout account information. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/stripe/account": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Create or update Stripe payout account",
      "description": "Submits Stripe connected-account details used for creator payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; Stripe account fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/stripe/legal": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get Stripe payout legal info",
      "description": "Retrieves the Stripe payout legal/agreement information for the creator. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit Stripe payout legal info",
      "description": "Submits legal information for a Stripe-based payout account. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/tax": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit payout tax info",
      "description": "Submits creator tax information for the payouts flow. Body is passed as the payload property. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque payload object; fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/tin": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit taxpayer identification number",
      "description": "Submits the creator's taxpayer identification number (TIN) for payout tax compliance. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "tin": {
                  "type": "string",
                  "description": "Taxpayer identification number"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/transactions": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List payout transactions",
      "description": "Returns paginated payout transaction records filtered by date/type/tips source. The `{id}` in path_raw is the appended querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "marker",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination marker"
        },
        {
          "name": "type",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Transaction type filter"
        },
        {
          "name": "tipsSource",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Tips source filter"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "list": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "amount": {
                              "type": "integer"
                            },
                            "vatAmount": {
                              "type": "integer"
                            },
                            "taxAmount": {
                              "type": "integer"
                            },
                            "mediaTaxAmount": {
                              "type": "integer"
                            },
                            "net": {
                              "type": "number"
                            },
                            "fee": {
                              "type": "number"
                            },
                            "createdAt": {
                              "type": "string"
                            },
                            "currency": {
                              "type": "string"
                            },
                            "description": {
                              "type": "string"
                            },
                            "descriptionDetails": {
                              "type": "object"
                            },
                            "status": {
                              "type": "string"
                            },
                            "user": {
                              "type": "object"
                            },
                            "payoutPendingDays": {
                              "type": "integer"
                            },
                            "id": {
                              "type": "string"
                            }
                          }
                        }
                      },
                      "marker": {
                        "type": "integer"
                      },
                      "hasMore": {
                        "type": "boolean"
                      },
                      "nextMarker": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/uk-company-data": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get UK company payout data",
      "description": "Returns the creator's stored UK company details used for payouts/tax. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit UK company payout data",
      "description": "Submits UK company data (for company/business payout accounts) as part of payout onboarding. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; UK company fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/vat": {
    "delete": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Delete VAT number",
      "description": "Removes the creator's VAT registration number. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Get payout VAT info",
      "description": "Retrieves the user's VAT information used for payouts (POST on the same path submits the VAT number). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "realFirstName": {
                        "type": "string"
                      },
                      "realLastName": {
                        "type": "string"
                      },
                      "creatorCompanyAddress": {
                        "type": "null"
                      },
                      "creatorCompanyName": {
                        "type": "null"
                      },
                      "creatorVatNumber": {
                        "type": "string"
                      },
                      "creatorCountry": {
                        "type": "null"
                      },
                      "creatorCountryCode": {
                        "type": "null"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit VAT number",
      "description": "Submits the creator's VAT registration number. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "vat": {
                  "type": "string",
                  "description": "VAT registration number"
                }
              }
            }
          }
        },
        "description": "Body literal is {vat:e}"
      }
    }
  },
  "/api2/v2/payouts/vat-requests": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Create a VAT request",
      "description": "Creates a VAT (value-added tax) request for payouts. Part of the payouts tax module (vat, qst, tax, dac7). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; spread of caller-provided fields, not statically visible"
      }
    }
  },
  "/api2/v2/payouts/vat/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get VAT payouts chart stats",
      "description": "Returns VAT payouts chart statistics (amount/count) over a date range. The dynamic path segment is the serialized querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals (defaults true)"
        },
        {
          "name": "withChart",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include chart series (set true)"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Chart amount/count filter"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/vats": {
    "get": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "List payout VAT records",
      "description": "Retrieves the list of VAT records associated with the creator's payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "list": {
                        "type": "array"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/payouts/w9": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit W-9 tax form",
      "description": "Submits the creator's IRS W-9 tax form data for payouts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; W-9 form data passed as {data:e}"
      }
    }
  },
  "/api2/v2/payouts/w9/address": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Submit W-9 address",
      "description": "Submits the address associated with the creator's W-9 tax form. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; address fields not statically visible"
      }
    }
  },
  "/api2/v2/payouts/w9/tincheck": {
    "post": {
      "tags": [
        "OF API — Payouts"
      ],
      "summary": "Verify W9 TIN",
      "description": "Runs a TIN (taxpayer ID) verification check for W9 payout tax information. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; TIN check fields not statically visible"
      }
    }
  },
  "/api2/v2/phones/change": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Cancel pending phone change",
      "description": "Cancels a pending phone-number change request (POST on the same path initiates one). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Request phone number change",
      "description": "Initiates a change of the account's phone number. A DELETE on the same path cancels a pending change. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/posts/bookmarks/categories/sort": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Sort bookmark categories",
      "description": "Sets the sort order of post bookmark categories. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; category ordering payload"
      }
    }
  },
  "/api2/v2/posts/bookmarks/categories/{category_id}": {
    "delete": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Delete a bookmark category",
      "description": "Deletes a post-bookmark category by id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "category_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the bookmark category to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "patch": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Rename bookmark category",
      "description": "Renames a post-bookmark category (DELETE removes it, POST creates one). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "category_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the bookmark category"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "New category name"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/posts/bookmarks/categories/{category_id}/{post_id}": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Add post to bookmark category",
      "description": "Adds a post to a bookmark category. Called as ({categoryId, postId}). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "category_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the bookmark category"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the post to add"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/posts/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get posts earnings chart",
      "description": "Returns time-series earnings/statistics for posts. The dynamic path segment is a built querystring, not an id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include totals in the response"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Metric filter (built from the 'by' argument plus posts)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "posts": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "purchases": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/posts/paid/pin/sort": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Sort pinned paid posts",
      "description": "Reorders the creator's pinned paid posts. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely ordered ids, not statically visible"
      }
    }
  },
  "/api2/v2/posts/top": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top posts stats",
      "description": "Returns top-performing posts statistics over a date range. The dynamic path segment is the serialized querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Metric to sort/group by"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "skip_users",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Skip embedding user objects (set to all)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/posts/{post_id}/bookmarks": {
    "delete": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Remove post from bookmarks",
      "description": "Removes the given post from the user's bookmarks; an optional chat_group_id can scope the removal to a specific bookmark group. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the post to un-bookmark"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Bookmark a post",
      "description": "Adds a post to bookmarks; an optional chat_group_id body targets a specific bookmark group. DELETE on the same path removes the bookmark. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the post to bookmark"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "chat_group_id": {
                  "type": "string",
                  "description": "Optional bookmark/chat group id; basic call sends no body"
                }
              }
            }
          }
        },
        "description": "Body optional"
      }
    }
  },
  "/api2/v2/posts/{post_id}/favorites/{author_id}": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Add post to favorites",
      "description": "Marks the given post (by the specified author) as a favorite for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the post to favorite"
        },
        {
          "name": "author_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "User ID of the post's author"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/posts/{post_id}/fund-raising-contributors/count": {
    "get": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Count fundraising contributors",
      "description": "Returns the number of contributors to a post's fundraising campaign. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the post"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/posts/{post_id}/hide": {
    "put": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Hide a post",
      "description": "Hides the specified post. Defined alongside post pin, favorite, vote and delete calls. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "post_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the post to hide"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/promotions": {
    "get": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "List promotions with stats",
      "description": "Retrieves promotions filtered by date range and pagination (statistics context). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of date range"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Max results"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "hasMore": {
                        "type": "boolean"
                      },
                      "items": {
                        "type": "array"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/promotions/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get promotions statistics chart",
      "description": "Returns chart/statistics data for promotions over a date range. Path segment is static; the trailing token is a serialized query string. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "stats",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Stats flag (set to 1)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "claims": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "total": {
                            "type": "integer"
                          }
                        }
                      },
                      "offers": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "total": {
                            "type": "integer"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/promotions/claim": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Claim a promotion by code",
      "description": "Claims a promotional offer using a promo code. Sends the code with a strictAuthCheck flag. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "Promotion code to claim"
                },
                "strictAuthCheck": {
                  "type": "integer",
                  "description": "Auth-check flag, sent as 1"
                }
              }
            }
          }
        },
        "description": "Enclosing fn claims a promotion offer code"
      }
    }
  },
  "/api2/v2/promotions/invite": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Send promotion invite",
      "description": "Sends an invitation for a promotion/promo offer. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/promotions/offer/{offer_id}": {
    "delete": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Delete a promotion offer",
      "description": "Deletes a single promotion offer identified by offer_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "offer_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the promotion offer to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Get promotion offer by ID",
      "description": "Fetches a single promotion offer by its ID. Sibling calls in the module handle claiming trials/promotions and confirming emails. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "offer_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the promotion offer to retrieve"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/promotions/offers/hide": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Hide promotion offers",
      "description": "Hides the current promotion offers from view. Defined alongside promotions/offers list and delete calls. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/promotions/{promotion_id}": {
    "delete": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Delete promotion",
      "description": "Deletes a subscription promotion by its ID. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "promotion_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the promotion to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/promotions/{promotion_id}/finish": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Finish a promotion",
      "description": "Ends/finishes an active promotion campaign identified by promotion id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "promotion_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the promotion to finish"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/release-form-documents": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Upload release form document",
      "description": "Uploads a release-form document (co-performer consent / model release). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/release-form-links": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Create release form link",
      "description": "Creates a release-form link (content consent document link) from the supplied data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/release-form-links/{link_id}/start": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Start release form link",
      "description": "Starts the flow for a release-form (consent) link identified by its id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "link_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the release-form link"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/release-form-links/{link_id}/url": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Generate release form link URL",
      "description": "Generates/returns a shareable URL for a release form link identified by link_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "link_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the release form link"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/release-form-proof": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit release form proof",
      "description": "Submits proof for a content release form (consent documentation). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/release-forms/attach": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Attach release form",
      "description": "Attaches a release form (content consent document) to content. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/release-forms/partner/{partner_id}": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get partner release forms",
      "description": "Retrieves release forms associated with a partner identified by partner id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "partner_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the partner whose release forms are fetched"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/release-forms/rename": {
    "patch": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Rename a release form",
      "description": "Renames a content release form. Part of the release-forms module (attach, links, documents, toggle-show). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/release-forms/toggle-show": {
    "patch": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Toggle release form visibility",
      "description": "Toggles the show/visibility state of release forms. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; toggle payload not statically visible"
      }
    }
  },
  "/api2/v2/reports/reasons": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "List content report reasons",
      "description": "Returns the list of available reasons for reporting content or users. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "integer"
                        },
                        "name": {
                          "type": "string"
                        },
                        "code": {
                          "type": "string"
                        },
                        "requiresIssue": {
                          "type": "boolean"
                        },
                        "subReasons": {
                          "type": "array",
                          "items": {
                            "type": "object"
                          }
                        },
                        "involves": {
                          "type": "array"
                        },
                        "issues": {
                          "type": "object",
                          "properties": {
                            "revenge_porn": {
                              "type": "string"
                            },
                            "expose": {
                              "type": "string"
                            },
                            "impersonation": {
                              "type": "string"
                            },
                            "underage": {
                              "type": "string"
                            },
                            "tm": {
                              "type": "string"
                            },
                            "spam": {
                              "type": "string"
                            },
                            "prostitution": {
                              "type": "string"
                            },
                            "weapons": {
                              "type": "string"
                            },
                            "drugs": {
                              "type": "string"
                            },
                            "other": {
                              "type": "string"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/reports/reasons/{reason_id}/details-options": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get report reason detail options",
      "description": "Retrieves the detail options available for a specific report reason. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "reason_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the report reason"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/schedules/{schedule_id}/publish": {
    "put": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Publish a scheduled item",
      "description": "Publishes a scheduled entity (e.g. queued post/stream) immediately by its schedule id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "schedule_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the scheduled item to publish"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/sessions": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Revoke all sessions",
      "description": "Terminates the user's active login sessions (used in the sessions settings screen). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "List active sessions",
      "description": "Retrieves the current user's active login sessions. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "isCurrent": {
                          "type": "boolean"
                        },
                        "lastActivity": {
                          "type": "integer"
                        },
                        "ipAddress": {
                          "type": "string"
                        },
                        "countryName": {
                          "type": "string"
                        },
                        "client": {
                          "type": "string"
                        },
                        "os": {
                          "type": "string"
                        },
                        "brand": {
                          "type": "string"
                        },
                        "loginMessage": {
                          "type": "null"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/shopify/stores/{store_id}": {
    "delete": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Delete Shopify store",
      "description": "Disconnects/removes a linked Shopify store by ID. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "store_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the linked Shopify store"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories": {
    "post": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Create story",
      "description": "Creates a new story for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; story payload not statically visible"
      }
    }
  },
  "/api2/v2/stories/answer/{answer_id}": {
    "delete": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Delete a story answer",
      "description": "Deletes a viewer's answer/reply to a story (e.g. story question sticker) identified by answer id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "answer_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the story answer to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get stories statistics chart",
      "description": "Returns time-series chart data for stories earnings/activity over a date range. The `{id}` in path_raw is actually the querystring appended by the Zq helper. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Whether to include totals"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Grouping/breakdown key"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Filter object (e.g. {stories:'stories'})"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "tips": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "stories": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/top": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top stories stats",
      "description": "Returns top-performing stories statistics for a date range, optionally grouped. The dynamic suffix in path_raw is the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Grouping/metric field"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/users/blocked": {
    "get": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "List story-blocked users",
      "description": "Returns users blocked from viewing the current user's stories. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/users/{user_id}/block": {
    "delete": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Unblock user from stories",
      "description": "Removes a user from the story block list (unblocks them from viewing stories). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user to unblock"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Block user from stories",
      "description": "Blocks the specified user from viewing the creator's stories. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the user to block from stories"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/{story_id}/like": {
    "delete": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Unlike a story",
      "description": "Removes a like from the specified story. Paired with a POST on the same path to like it. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "story_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the story to unlike"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Like a story",
      "description": "Likes the story identified by story_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "story_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the story to like"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/{story_id}/viewers": {
    "get": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "List story viewers",
      "description": "Returns the list of viewers for a story, with pagination; a variant filters to only viewers who tipped. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "story_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the story"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Page size"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "onlyWithTips",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Return only viewers who tipped (used by one variant)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/stories/{story_id}/watched": {
    "put": {
      "tags": [
        "OF API — Stories"
      ],
      "summary": "Mark story as watched",
      "description": "Marks a story as watched/seen by the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "story_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the story to mark watched"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streaks": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get streaks over date range",
      "description": "Retrieves subscriber/engagement streak statistics over a date range. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of date range"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "list": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "id": {
                              "type": "integer"
                            },
                            "startDate": {
                              "type": "string"
                            },
                            "endDate": {
                              "type": "string"
                            },
                            "isActive": {
                              "type": "boolean"
                            },
                            "postsCount": {
                              "type": "integer"
                            },
                            "daysCount": {
                              "type": "integer"
                            },
                            "streamsDuration": {
                              "type": "integer"
                            },
                            "storiesCount": {
                              "type": "integer"
                            },
                            "chatsCount": {
                              "type": "integer"
                            },
                            "frozenDays": {
                              "type": "array"
                            }
                          }
                        }
                      },
                      "hasMore": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streaks/top": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top streaks",
      "description": "Returns the top fan streaks for the creator. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "integer"
                      },
                      "startDate": {
                        "type": "string"
                      },
                      "endDate": {
                        "type": "string"
                      },
                      "isActive": {
                        "type": "boolean"
                      },
                      "postsCount": {
                        "type": "integer"
                      },
                      "daysCount": {
                        "type": "integer"
                      },
                      "streamsDuration": {
                        "type": "integer"
                      },
                      "storiesCount": {
                        "type": "integer"
                      },
                      "chatsCount": {
                        "type": "integer"
                      },
                      "frozenDays": {
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get streams stats chart",
      "description": "Returns time-series chart data for live-stream statistics over a date range. The dynamic path segment is actually the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "withTotal",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Whether to include totals"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Filter object (keyed by the 'by' field, plus duration)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "duration": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "purchases": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/top": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top streams stats",
      "description": "Returns top-performing live streams over a date range, ranked (default by purchases) with pagination. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Page size (default 10)"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset (default 0)"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Ranking metric (default 'purchases')"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/users/{user_id}/block": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Unblock stream viewer",
      "description": "Unblocks a previously blocked live-stream viewer by user ID. Enclosing fn unblockStreamViewerByUserId. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the viewer to unblock"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/users/{username}/block": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Block stream viewer by name",
      "description": "Blocks a live-stream viewer identified by their username (blockStreamViewerByName). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "username",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Username of the stream viewer to block"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Delete a stream",
      "description": "Deletes a live stream identified by stream id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Get stream details",
      "description": "Retrieves a live stream by its id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "patch": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Update a stream",
      "description": "Updates properties of an existing live stream. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream (taken from the body's id field)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Stream id (also used in the path)"
                }
              }
            }
          }
        },
        "description": "full stream object; remaining fields not statically visible"
      }
    }
  },
  "/api2/v2/streams/{stream_id}/accept": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Accept dual-stream invite",
      "description": "Accepts an invitation to join a dual (co-host) live stream identified by stream id (acceptDualStreamInvite). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream whose invite is accepted"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/active": {
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Check if stream active",
      "description": "Checks whether the specified live stream is currently active. Enclosing fn checkStreamActive. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the live stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/block": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Block stream viewer",
      "description": "Blocks a viewer in a live stream, optionally permanently. Called as blockStreamViewer({streamId, userId, isPermanent}). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "userId": {
                  "type": "string|number",
                  "description": "ID of the viewer to block"
                },
                "isPermanent": {
                  "type": "boolean",
                  "description": "Whether the block is permanent (default false)"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/cancel": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Cancel dual-stream request",
      "description": "Cancels a pending dual-stream (co-streaming) request for the given stream (enclosing fn cancelDualStreamRequest). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the stream whose dual-stream request is cancelled"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/comments/{comment_id}": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Delete stream comment",
      "description": "Removes a comment from a live stream. Called as removeComment(streamId, commentId). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the comment to remove"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Get a single stream comment",
      "description": "Fetches a single comment on a live stream by stream and comment id (enclosing fn getStreamComment). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the stream"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the stream comment"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/comments/{comment_id}/pin": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Unpin a stream comment",
      "description": "Removes the pin from a comment on a live stream. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the stream"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the pinned comment to unpin"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Pin a stream comment",
      "description": "Pins a comment within a live stream (DELETE on the same path unpins it). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "comment_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the comment to pin"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/cover": {
    "put": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Save live stream cover",
      "description": "Saves/updates the cover image for a live stream (enclosing fn saveStreamCover). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the stream whose cover is set"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (cover selection/data); fields not statically visible"
      }
    }
  },
  "/api2/v2/streams/{stream_id}/covers": {
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Fetch stream covers",
      "description": "Fetches available cover images for a stream (fetchStreamCovers). Retries on HTTP 400. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/decline": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Decline dual-stream invite",
      "description": "Declines an invitation to join a dual (co-host) live stream. Enclosing fn declineDualStreamInvite. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream whose invite is declined"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/finish": {
    "put": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Finish a live stream",
      "description": "Ends the live stream identified by stream_id. Enclosing fn is finishStream. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream to finish"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (2nd arg); fields not statically visible"
      }
    }
  },
  "/api2/v2/streams/{stream_id}/hide": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Hide stream",
      "description": "Hides the specified live stream from the feed. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the live stream to hide"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/is-viewer": {
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Check if current user is viewer",
      "description": "Checks whether the current user is a viewer of the given stream (checkViewer). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/join": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Join a dual stream",
      "description": "Requests to join a dual (co-host) live stream identified by stream_id. Enclosing fn is joinDualStreamRequest. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream to join"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/likes": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Add likes to stream",
      "description": "Adds a number of likes to a live stream (streamLikes). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "likes": {
                  "type": "number",
                  "description": "Number of likes to add"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/look": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Stop looking at a stream",
      "description": "Removes the current viewer's 'look' marker on a stream (streamUnlook). Paired with a POST on the same path (streamLook). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Mark viewing a stream",
      "description": "Registers the current user as actively looking at the stream. Enclosing fn is streamLook. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream being viewed"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/make-post": {
    "put": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Save stream as a post",
      "description": "Saves a finished live stream as a feed post (saveStreamAsPost). Requires the stream ID and additional post fields. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream to save as a post"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "Stream ID (echoed into the body)"
                }
              }
            }
          }
        },
        "description": "Additional post fields are spread from caller and not statically visible."
      }
    }
  },
  "/api2/v2/streams/{stream_id}/reminder": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Remove stream reminder",
      "description": "Removes the reminder the user set for the scheduled stream identified by stream_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream to remove the reminder for"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Set stream reminder",
      "description": "Sets a reminder for an upcoming/scheduled live stream. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/tweet": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Share stream to Twitter",
      "description": "Tweets/shares the live stream identified by stream_id with preview options. Enclosing fn is sendStreamTweet. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream to tweet"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "tweetWithPreview": {
                  "type": "boolean",
                  "description": "Include stream preview in tweet"
                },
                "tweetWithStillPreview": {
                  "type": "boolean",
                  "description": "Include still-image preview in tweet"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/user/{user_id}/comments": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Remove a user's stream comments",
      "description": "Removes all comments from a specific user within a live stream (removeComment by user). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the live stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user whose comments are removed"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/users/{user_id}/accept": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Accept dual-stream request",
      "description": "Accepts a user's request to join a dual/co-stream (acceptDualStreamRequest). Sibling calls decline, cancel or invite users. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user whose dual-stream request is accepted"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/users/{user_id}/cancel": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Cancel dual-stream invite",
      "description": "Cancels a pending dual-stream (co-stream) invite for a user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the invited user"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/users/{user_id}/decline": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Decline dual-stream request",
      "description": "Declines a dual-stream (co-stream) request from a user (declineDualStreamRequest). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the requesting user"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/users/{user_id}/helper": {
    "delete": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Remove stream helper",
      "description": "Removes a user's helper (moderator) role on a live stream. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the helper user"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Add stream helper",
      "description": "Grants a user helper (moderator) permissions on a live stream. Enclosing fn addStreamHelper. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the live stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user to grant helper role"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/users/{user_id}/invite": {
    "post": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Invite user to dual stream",
      "description": "Invites a user to join a dual/co-stream. Called as inviteDualStream({streamId, userId}). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user to invite"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/viewers": {
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "List stream viewers",
      "description": "Lists viewers of a stream (optionally only those with tips), with pagination. The trailing dynamic segment is a querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Page size"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "withFinishedViewers",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include viewers who left/finished"
        },
        {
          "name": "onlyCurrentStreamTips",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Restrict tips to the current stream"
        },
        {
          "name": "onlyWithTips",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Only viewers who tipped (variant)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/streams/{stream_id}/viewers/{user_id}": {
    "get": {
      "tags": [
        "OF API — Streams"
      ],
      "summary": "Get a stream viewer",
      "description": "Retrieves details for a single viewer of a live stream. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "stream_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the stream"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the viewer user"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/bundles/{bundle_id}": {
    "delete": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Delete subscription bundle",
      "description": "Deletes a subscription bundle offer. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "bundle_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the subscription bundle to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Update subscription bundle",
      "description": "Updates a subscription bundle (discounted multi-month offer) by ID. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "bundle_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the subscription bundle (from body e.id)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; full bundle object including id"
      }
    }
  },
  "/api2/v2/subscriptions/subscribers": {
    "get": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "List subscribers",
      "description": "Returns paginated subscribers, filterable by trial or promo. The `{id}` in path_raw is the appended querystring; the id/kind args become a filter object. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Page size"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "format",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Response format (defaults to 'infinite')"
        },
        {
          "name": "filter",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Filter object: {trial_id} when kind='trial' else {promoId}"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "view": {
                          "type": "string"
                        },
                        "avatar": {
                          "type": "null"
                        },
                        "avatarThumbs": {
                          "type": "null"
                        },
                        "header": {
                          "type": "null"
                        },
                        "headerSize": {
                          "type": "null"
                        },
                        "headerThumbs": {
                          "type": "null"
                        },
                        "id": {
                          "type": "integer"
                        },
                        "name": {
                          "type": "string"
                        },
                        "username": {
                          "type": "string"
                        },
                        "canLookStory": {
                          "type": "boolean"
                        },
                        "canCommentStory": {
                          "type": "boolean"
                        },
                        "hasNotViewedStory": {
                          "type": "boolean"
                        },
                        "isVerified": {
                          "type": "boolean"
                        },
                        "canPayInternal": {
                          "type": "boolean"
                        },
                        "hasScheduledStream": {
                          "type": "boolean"
                        },
                        "hasStream": {
                          "type": "boolean"
                        },
                        "hasStories": {
                          "type": "boolean"
                        },
                        "tipsEnabled": {
                          "type": "boolean"
                        },
                        "tipsTextEnabled": {
                          "type": "boolean"
                        },
                        "tipsMin": {
                          "type": "integer"
                        },
                        "tipsMinInternal": {
                          "type": "integer"
                        },
                        "tipsMax": {
                          "type": "integer"
                        },
                        "canEarn": {
                          "type": "boolean"
                        },
                        "canAddSubscriber": {
                          "type": "boolean"
                        },
                        "subscribePrice": {
                          "type": "integer"
                        },
                        "displayName": {
                          "type": "string"
                        },
                        "notice": {
                          "type": "string"
                        },
                        "isActive": {
                          "type": "boolean"
                        },
                        "isRestricted": {
                          "type": "boolean"
                        },
                        "canRestrict": {
                          "type": "boolean"
                        },
                        "subscribedBy": {
                          "type": "boolean"
                        },
                        "subscribedByExpire": {
                          "type": "boolean"
                        },
                        "subscribedByExpireDate": {
                          "type": "string"
                        },
                        "subscribedByAutoprolong": {
                          "type": "boolean"
                        },
                        "subscribedIsExpiredNow": {
                          "type": "boolean"
                        },
                        "currentSubscribePrice": {
                          "type": "integer"
                        },
                        "subscribedOn": {
                          "type": "boolean"
                        },
                        "subscribedOnExpire": {
                          "type": "boolean"
                        },
                        "subscribedOnExpiredNow": {
                          "type": "boolean"
                        },
                        "subscribedOnDuration": {
                          "type": "string"
                        },
                        "listsStates": {
                          "type": "array",
                          "items": {
                            "type": "object"
                          }
                        },
                        "canReport": {
                          "type": "boolean"
                        },
                        "canReceiveChatMessage": {
                          "type": "boolean"
                        },
                        "hideChat": {
                          "type": "boolean"
                        },
                        "lastSeen": {
                          "type": "null"
                        },
                        "isPerformer": {
                          "type": "boolean"
                        },
                        "isRealPerformer": {
                          "type": "boolean"
                        },
                        "subscribedByData": {
                          "type": "object",
                          "properties": {
                            "price": {
                              "type": "integer"
                            },
                            "newPrice": {
                              "type": "integer"
                            },
                            "regularPrice": {
                              "type": "integer"
                            },
                            "subscribePrice": {
                              "type": "integer"
                            },
                            "discountPercent": {
                              "type": "integer"
                            },
                            "discountPeriod": {
                              "type": "integer"
                            },
                            "subscribeAt": {
                              "type": "string"
                            },
                            "expiredAt": {
                              "type": "string"
                            },
                            "renewedAt": {
                              "type": "string"
                            },
                            "discountFinishedAt": {
                              "type": "null"
                            },
                            "discountStartedAt": {
                              "type": "null"
                            },
                            "status": {
                              "type": "null"
                            },
                            "isMuted": {
                              "type": "boolean"
                            },
                            "unsubscribeReason": {
                              "type": "string"
                            },
                            "duration": {
                              "type": "string"
                            },
                            "showPostsInFeed": {
                              "type": "boolean"
                            },
                            "subscribes": {
                              "type": "array"
                            },
                            "hasActivePaidSubscriptions": {
                              "type": "boolean"
                            }
                          }
                        },
                        "subscribedOnData": {
                          "type": "object",
                          "properties": {
                            "price": {
                              "type": "integer"
                            },
                            "newPrice": {
                              "type": "integer"
                            },
                            "regularPrice": {
                              "type": "integer"
                            },
                            "subscribePrice": {
                              "type": "integer"
                            },
                            "discountPercent": {
                              "type": "integer"
                            },
                            "discountPeriod": {
                              "type": "integer"
                            },
                            "subscribeAt": {
                              "type": "string"
                            },
                            "expiredAt": {
                              "type": "string"
                            },
                            "renewedAt": {
                              "type": "string"
                            },
                            "discountFinishedAt": {
                              "type": "null"
                            },
                            "discountStartedAt": {
                              "type": "null"
                            },
                            "status": {
                              "type": "null"
                            },
                            "isMuted": {
                              "type": "boolean"
                            },
                            "unsubscribeReason": {
                              "type": "string"
                            },
                            "duration": {
                              "type": "string"
                            },
                            "tipsSumm": {
                              "type": "integer"
                            },
                            "subscribesSumm": {
                              "type": "integer"
                            },
                            "messagesSumm": {
                              "type": "number"
                            },
                            "postsSumm": {
                              "type": "integer"
                            },
                            "streamsSumm": {
                              "type": "integer"
                            },
                            "totalSumm": {
                              "type": "number"
                            },
                            "lastActivity": {
                              "type": "string"
                            },
                            "recommendations": {
                              "type": "integer"
                            },
                            "subscribes": {
                              "type": "array"
                            },
                            "hasActivePaidSubscriptions": {
                              "type": "boolean"
                            }
                          }
                        },
                        "canTrialSend": {
                          "type": "boolean"
                        },
                        "isBlocked": {
                          "type": "boolean"
                        },
                        "promoOffers": {
                          "type": "array"
                        },
                        "canUnsubscribe": {
                          "type": "boolean"
                        },
                        "isPendingAutoprolong": {
                          "type": "boolean"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/subscribers/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get subscribers statistics chart",
      "description": "Returns chart/statistics data for subscribers over a date range, groupable via 'by'. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Grouping/breakdown dimension"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "earnings": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "date": {
                              "type": "string"
                            },
                            "count": {
                              "type": "integer"
                            }
                          }
                        }
                      },
                      "subscribes": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "date": {
                              "type": "string"
                            },
                            "count": {
                              "type": "integer"
                            }
                          }
                        }
                      },
                      "total": {
                        "type": "integer"
                      },
                      "subscribers": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/subscribers/latest": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get latest subscribers",
      "description": "Returns the latest subscribers within a date range, grouped by the given field. The dynamic path segment is actually the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Grouping/aggregation field"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "users": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "view": {
                              "type": "string"
                            },
                            "avatar": {
                              "type": "null"
                            },
                            "avatarThumbs": {
                              "type": "null"
                            },
                            "header": {
                              "type": "null"
                            },
                            "headerSize": {
                              "type": "null"
                            },
                            "headerThumbs": {
                              "type": "null"
                            },
                            "id": {
                              "type": "integer"
                            },
                            "name": {
                              "type": "string"
                            },
                            "username": {
                              "type": "string"
                            },
                            "canLookStory": {
                              "type": "boolean"
                            },
                            "canCommentStory": {
                              "type": "boolean"
                            },
                            "hasNotViewedStory": {
                              "type": "boolean"
                            },
                            "isVerified": {
                              "type": "boolean"
                            },
                            "canPayInternal": {
                              "type": "boolean"
                            },
                            "hasScheduledStream": {
                              "type": "boolean"
                            },
                            "hasStream": {
                              "type": "boolean"
                            },
                            "hasStories": {
                              "type": "boolean"
                            },
                            "tipsEnabled": {
                              "type": "boolean"
                            },
                            "tipsTextEnabled": {
                              "type": "boolean"
                            },
                            "tipsMin": {
                              "type": "integer"
                            },
                            "tipsMinInternal": {
                              "type": "integer"
                            },
                            "tipsMax": {
                              "type": "integer"
                            },
                            "canEarn": {
                              "type": "boolean"
                            },
                            "canAddSubscriber": {
                              "type": "boolean"
                            },
                            "subscribePrice": {
                              "type": "integer"
                            },
                            "displayName": {
                              "type": "string"
                            },
                            "notice": {
                              "type": "string"
                            },
                            "isActive": {
                              "type": "boolean"
                            },
                            "isRestricted": {
                              "type": "boolean"
                            },
                            "canRestrict": {
                              "type": "boolean"
                            },
                            "subscribedBy": {
                              "type": "boolean"
                            },
                            "subscribedByExpire": {
                              "type": "boolean"
                            },
                            "subscribedByExpireDate": {
                              "type": "string"
                            },
                            "subscribedByAutoprolong": {
                              "type": "boolean"
                            },
                            "subscribedIsExpiredNow": {
                              "type": "boolean"
                            },
                            "currentSubscribePrice": {
                              "type": "integer"
                            },
                            "subscribedOn": {
                              "type": "boolean"
                            },
                            "subscribedOnExpire": {
                              "type": "boolean"
                            },
                            "subscribedOnExpiredNow": {
                              "type": "boolean"
                            },
                            "subscribedOnDuration": {
                              "type": "string"
                            },
                            "listsStates": {
                              "type": "array"
                            },
                            "canReport": {
                              "type": "boolean"
                            },
                            "canReceiveChatMessage": {
                              "type": "boolean"
                            },
                            "hideChat": {
                              "type": "boolean"
                            },
                            "lastSeen": {
                              "type": "string"
                            },
                            "isPerformer": {
                              "type": "boolean"
                            },
                            "isRealPerformer": {
                              "type": "boolean"
                            },
                            "subscribedByData": {
                              "type": "object"
                            },
                            "subscribedOnData": {
                              "type": "object"
                            },
                            "canTrialSend": {
                              "type": "boolean"
                            },
                            "isBlocked": {
                              "type": "boolean"
                            },
                            "canUnsubscribe": {
                              "type": "boolean"
                            },
                            "isPendingAutoprolong": {
                              "type": "boolean"
                            }
                          }
                        }
                      },
                      "offset": {
                        "type": "integer"
                      },
                      "hasMore": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/subscribers/top": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top subscribers stats",
      "description": "Retrieves top subscribers over a date range (statistics context). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Start of date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "End of date range"
        },
        {
          "name": "by",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Metric to rank by"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "users": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "view": {
                              "type": "string"
                            },
                            "avatar": {
                              "type": "null"
                            },
                            "avatarThumbs": {
                              "type": "null"
                            },
                            "header": {
                              "type": "null"
                            },
                            "headerSize": {
                              "type": "null"
                            },
                            "headerThumbs": {
                              "type": "null"
                            },
                            "id": {
                              "type": "integer"
                            },
                            "name": {
                              "type": "string"
                            },
                            "username": {
                              "type": "string"
                            },
                            "canLookStory": {
                              "type": "boolean"
                            },
                            "canCommentStory": {
                              "type": "boolean"
                            },
                            "hasNotViewedStory": {
                              "type": "boolean"
                            },
                            "isVerified": {
                              "type": "boolean"
                            },
                            "canPayInternal": {
                              "type": "boolean"
                            },
                            "hasScheduledStream": {
                              "type": "boolean"
                            },
                            "hasStream": {
                              "type": "boolean"
                            },
                            "hasStories": {
                              "type": "boolean"
                            },
                            "tipsEnabled": {
                              "type": "boolean"
                            },
                            "tipsTextEnabled": {
                              "type": "boolean"
                            },
                            "tipsMin": {
                              "type": "integer"
                            },
                            "tipsMinInternal": {
                              "type": "integer"
                            },
                            "tipsMax": {
                              "type": "integer"
                            },
                            "canEarn": {
                              "type": "boolean"
                            },
                            "canAddSubscriber": {
                              "type": "boolean"
                            },
                            "subscribePrice": {
                              "type": "integer"
                            },
                            "displayName": {
                              "type": "string"
                            },
                            "notice": {
                              "type": "string"
                            },
                            "isActive": {
                              "type": "boolean"
                            },
                            "isRestricted": {
                              "type": "boolean"
                            },
                            "canRestrict": {
                              "type": "boolean"
                            },
                            "subscribedBy": {
                              "type": "boolean"
                            },
                            "subscribedByExpire": {
                              "type": "boolean"
                            },
                            "subscribedByExpireDate": {
                              "type": "string"
                            },
                            "subscribedByAutoprolong": {
                              "type": "boolean"
                            },
                            "subscribedIsExpiredNow": {
                              "type": "boolean"
                            },
                            "currentSubscribePrice": {
                              "type": "integer"
                            },
                            "subscribedOn": {
                              "type": "null"
                            },
                            "subscribedOnExpire": {
                              "type": "boolean"
                            },
                            "subscribedOnExpiredNow": {
                              "type": "boolean"
                            },
                            "subscribedOnDuration": {
                              "type": "string"
                            },
                            "listsStates": {
                              "type": "array"
                            },
                            "canReport": {
                              "type": "boolean"
                            },
                            "canReceiveChatMessage": {
                              "type": "boolean"
                            },
                            "hideChat": {
                              "type": "boolean"
                            },
                            "lastSeen": {
                              "type": "string"
                            },
                            "isPerformer": {
                              "type": "boolean"
                            },
                            "isRealPerformer": {
                              "type": "boolean"
                            },
                            "subscribedByData": {
                              "type": "object"
                            },
                            "subscribedOnData": {
                              "type": "object"
                            },
                            "canTrialSend": {
                              "type": "boolean"
                            },
                            "isBlocked": {
                              "type": "boolean"
                            },
                            "canUnsubscribe": {
                              "type": "boolean"
                            },
                            "isPendingAutoprolong": {
                              "type": "boolean"
                            }
                          }
                        }
                      },
                      "hasMore": {
                        "type": "boolean"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/{subscription_id}": {
    "put": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Update a subscription",
      "description": "Updates settings for the given subscription. Sibling calls manage autoprolong, hide-posts and price-change hints. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "subscription_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the subscription to update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/subscriptions/{subscription_id}/attention": {
    "delete": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Dismiss subscription attention flag",
      "description": "Clears/dismisses the 'attention' flag on a subscription. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "subscription_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the subscription whose attention flag is cleared"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/{subscription_id}/hide-posts": {
    "delete": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Unhide subscription posts",
      "description": "Re-shows posts from a subscription previously hidden (PUT on the same path hides them). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "subscription_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the subscription"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Hide posts from subscription",
      "description": "Hides posts from the given subscription in the user's feed. Paired with a DELETE on the same path to unhide. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "subscription_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the subscription (subscribed user) to hide posts from"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/subscriptions/{subscription_id}/price-change-hint": {
    "delete": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Dismiss price-change hint",
      "description": "Dismisses the price-change hint/notice for a subscription. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "subscription_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the subscription"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/texts/search": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Search localization texts",
      "description": "Searches localization strings by code and languages. Part of the i18n text system (texts.onlyfans.com). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "Text/translation key to search"
                },
                "languages": {
                  "type": "array",
                  "description": "Languages to search within"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/texts/{code}": {
    "put": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Update a localization text",
      "description": "Updates the localized text string for a given text code. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "code",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Localization/text string code"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "text": {
                  "type": "string",
                  "description": "New text content for the code"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/trials/chart": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get trials chart stats",
      "description": "Returns trial statistics chart data over a date range. The dynamic path segment is the serialized querystring, not a path param. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "stats",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Include stats flag (set to 1)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "claims": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "total": {
                            "type": "integer"
                          }
                        }
                      },
                      "offers": {
                        "type": "object",
                        "properties": {
                          "chart": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "total": {
                            "type": "integer"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/trials/check": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Check and reserve trial code",
      "description": "Validates a free-trial link code and reserves it for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "Trial link code to validate"
                },
                "reserve": {
                  "type": "boolean",
                  "description": "Reserve the trial (sent as true)"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/trials/claim": {
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Claim free trial by code",
      "description": "Claims a free-trial subscription offer using a trial code. The code is sent in the request body. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "Trial/promo code to claim"
                }
              }
            }
          }
        },
        "description": "Body literal is {code:e}"
      }
    }
  },
  "/api2/v2/trials/share-access": {
    "delete": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Revoke trial share access",
      "description": "Revokes shared free-trial access. The request carries a body via the delete data option. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Share trial access",
      "description": "Creates a shared free-trial access grant. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/trials/stats": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get trial link statistics",
      "description": "Returns statistics for free-trial links over a date range with pagination. The dynamic suffix in path_raw is the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Max results"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "hasMore": {
                        "type": "boolean"
                      },
                      "items": {
                        "type": "array"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/trials/{trial_id}": {
    "delete": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Delete a trial link",
      "description": "Deletes a free-trial subscription link/campaign identified by trial id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "trial_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the trial to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Update trial link",
      "description": "Updates a trial-subscription link by ID (e.g. finishes/deactivates it). No request body is sent. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "trial_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the trial link"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/trust": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Mark device as trusted",
      "description": "Marks the current session/device as trusted. Found next to webauthn, oauth/confirm and logout auth calls. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/unsubscribe/reasons": {
    "get": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "List unsubscribe reasons",
      "description": "Returns the selectable reasons offered when a fan unsubscribes. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "integer"
                        },
                        "name": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/upload/signed/create": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Create signed media upload",
      "description": "Stage 1 of OnlyFans' media upload. Returns pre-signed S3 URL(s) that you then PUT the bytes to.\n\n**Body** (verified live 2026-08-06):\n```json\n{ \"key\": \"upload/{uuid4}/{nonce}/{url-encoded-lowercased-filename}\", \"parts\": 1, \"contentType\": \"image/jpeg\", \"secure\": false }\n```\nThe `key` prefix comes from `GET /api2/v2/init` → `upload.s3.uploadPath` (`upload/`, or `upload/secure/` when `secure` is true). `parts` is `floor(size / 5242880) + 1` for files ≥ 5 MiB, else `1`.\n\n**A wrong or missing `key` is what produces `400 {\"error\":{\"message\":\"Bad key\"}}`** — the field really is named `key`, and it must be a path under the account's upload prefix.\n\nResponse: `{ keys: [{putUrl}], uploadId, putUrl, getUrl }`. Multipart when `keys[]` is populated and the file is ≥ 5 MiB; otherwise PUT the whole file to `putUrl`.\n\n**You normally don't call this directly** — `POST /accounts/{of_user_id}/media` runs all four stages for you.\n\n**OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["key", "parts", "contentType"],
              "properties": {
                "key": {
                  "type": "string",
                  "description": "Storage PATH, not a filename — `{uploadPath}{uuid4}/{nonce}/{url-encoded lowercased filename}`. `uploadPath` comes from GET /api2/v2/init → `upload.s3.uploadPath` (`upload/`, or `upload/secure/` when secure=true). A missing or malformed value is what returns `400 Bad key`.",
                  "example": "upload/0e683d4d-1726-4506-a04d-2a5d05f5b9e1/1031326954680/photo.jpg"
                },
                "parts": {
                  "type": "integer",
                  "description": "Number of 5 MiB S3 parts: `floor(size / 5242880) + 1` for files ≥ 5 MiB, otherwise 1.",
                  "minimum": 1,
                  "example": 1
                },
                "contentType": {
                  "type": "string",
                  "description": "MIME type of the file. `.heic` must be sent as `image/heic`.",
                  "example": "image/jpeg"
                },
                "secure": {
                  "type": "boolean",
                  "description": "Use the secure (DRM) upload prefix instead of the standard one.",
                  "default": false
                }
              }
            },
            "example": {
              "key": "upload/0e683d4d-1726-4506-a04d-2a5d05f5b9e1/1031326954680/photo.jpg",
              "parts": 1,
              "contentType": "image/jpeg",
              "secure": false
            }
          }
        },
        "description": "Upload descriptor. Prefer POST /accounts/{of_user_id}/media, which runs all four stages for you."
      }
    }
  },
  "/api2/v2/upload/signed/finish": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Finish signed upload",
      "description": "Stage 3 of OnlyFans' media upload — completes an S3 **multipart** upload after every part has been PUT.\n\n**Body** (verified live 2026-08-06):\n```json\n{ \"key\": \"<same key as create>\", \"parts\": [{ \"ETag\": \"\\\"abc…\\\"\", \"PartNumber\": 1 }], \"uploadId\": \"<from create>\", \"secure\": false }\n```\nReturns `{ \"ETag\": \"…\" }` for the assembled object.\n\nSingle-part uploads (< 5 MiB) **skip this call** — the ETag comes straight off the S3 PUT response.\n\nNote that neither this nor `create` puts anything in the vault; a fourth stage hands the S3 descriptor to OnlyFans' converter host (`GET /api2/v2/init` → `upload.geoUploadHosts`). `POST /accounts/{of_user_id}/media` does all of it for you.\n\n**OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "required": true,
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "required": ["key", "parts", "uploadId"],
              "properties": {
                "key": {
                  "type": "string",
                  "description": "The same `key` passed to upload/signed/create.",
                  "example": "upload/0e683d4d-1726-4506-a04d-2a5d05f5b9e1/1031326954680/photo.jpg"
                },
                "parts": {
                  "type": "array",
                  "description": "One entry per uploaded S3 part, in order. `ETag` is the quoted value from that part's PUT response header.",
                  "items": {
                    "type": "object",
                    "required": ["ETag", "PartNumber"],
                    "properties": {
                      "ETag": { "type": "string", "example": "\"5623a10f3404a04d201a8e38aea195d6\"" },
                      "PartNumber": { "type": "integer", "minimum": 1, "example": 1 }
                    }
                  }
                },
                "uploadId": {
                  "type": "string",
                  "description": "The `uploadId` returned by upload/signed/create."
                },
                "secure": {
                  "type": "boolean",
                  "description": "Must match the value used on create.",
                  "default": false
                }
              }
            },
            "example": {
              "key": "upload/0e683d4d-1726-4506-a04d-2a5d05f5b9e1/1031326954680/photo.jpg",
              "parts": [{ "ETag": "\"5623a10f3404a04d201a8e38aea195d6\"", "PartNumber": 1 }],
              "uploadId": "2~abc123",
              "secure": false
            }
          }
        },
        "description": "Multipart completion. Single-part uploads (< 5 MiB) skip this call entirely — the ETag comes off the PUT response. Prefer POST /accounts/{of_user_id}/media."
      }
    }
  },
  "/api2/v2/users/alert": {
    "get": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Get user alerts",
      "description": "Returns the current user's alert(s) banner data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/alert/{alert_id}": {
    "delete": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Delete user alert",
      "description": "Deletes a user alert by id. Related to users/mass-alert endpoints (creator alert broadcasts). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "alert_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the alert to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/appeal": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Submit account appeal",
      "description": "Submits an appeal, e.g. against an account restriction or moderation action. Defined near reports/reasons and unsubscribe/reasons calls. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/change-password": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Change password",
      "description": "Changes the current user's account password. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely current + new password, not statically visible"
      }
    }
  },
  "/api2/v2/users/clicks-stats": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Report user click statistics",
      "description": "Sends a batch of user click/interaction statistics for tracking. The response is fire-and-forget (errors are swallowed via .catch). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible (click-tracking payload)"
      }
    }
  },
  "/api2/v2/users/connect": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Connect a linked account",
      "description": "Connects/links another account to the current user (used for multi-account switching). Paired with DELETE /users/connect/{id}. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; connection/credentials payload"
      }
    }
  },
  "/api2/v2/users/connect/{account_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Disconnect a linked account",
      "description": "Disconnects a linked/connected account identified by account_id. Enclosing fn is a disconnect helper. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "account_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the connected account to disconnect"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/delete/request": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Cancel account deletion request",
      "description": "Cancels a previously submitted account-deletion request. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Request account deletion",
      "description": "Submits a request to delete the current user's account. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "captchaCode": {
                  "type": "string",
                  "description": "Captcha verification code"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/exists": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Check if username exists",
      "description": "Checks whether a username is already taken. Body carries the username to check. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "username": {
                  "type": "string",
                  "description": "Username to check for existence"
                }
              }
            }
          }
        },
        "description": "Uses skip429Alert retry option"
      }
    }
  },
  "/api2/v2/users/forgot-password": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Request password reset",
      "description": "Initiates a forgot-password / password-reset request. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely contains email"
      }
    }
  },
  "/api2/v2/users/get-auth-token": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get auth token",
      "description": "Retrieves an authentication token for the user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/get-otp-token": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get OTP token",
      "description": "Exchanges credentials for a one-time-password token. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/helper-logout": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Log out helper session",
      "description": "Ends a helper (login-as-helper) session and returns to the primary account. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/hints/{hint_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Dismiss user hint",
      "description": "Dismisses a UI hint/recommendation by ID for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "hint_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the hint to dismiss"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/license_form": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Submit license form",
      "description": "Submits a license form for the current user (identity/creator license documentation). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; license form data"
      }
    }
  },
  "/api2/v2/users/links": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get user links",
      "description": "Retrieves the current user's configured profile links. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Add profile link",
      "description": "Adds a custom link to the current user's profile. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object (defaults to {}); fields not statically visible"
      }
    },
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update a user link",
      "description": "Updates one of the user's external profile links. Sibling calls list, create and delete links. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "link": {
                  "type": "string|object",
                  "description": "The link value to update"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/links/{link_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Delete a user link",
      "description": "Deletes one of the user's profile links by id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "link_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the link to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/login": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Log in user",
      "description": "Authenticates a user and starts a session. Accepts login credentials in the request body. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible (likely email/username + password)"
      }
    }
  },
  "/api2/v2/users/login-as-helper/{helper_id}": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Log in as a helper",
      "description": "Impersonates/switches into a helper (team member) account identified by helper id. Paired with POST /users/helper-logout. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "helper_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the helper account to log in as"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/logout": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Log out current user",
      "description": "Logs out the currently authenticated user session. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/mass-alert/{alert_id}": {
    "delete": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Dismiss a mass alert",
      "description": "Dismisses/deletes a mass alert notification identified by alert id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "alert_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the mass alert to dismiss"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/mass-hints/{hint_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Delete mass message hint",
      "description": "Deletes a mass-message hint for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "hint_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the mass-message hint to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/auth-token": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get current auth token",
      "description": "Retrieves an auth token for the current user (used for authenticated sub-flows). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "token": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/id": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get current user ID",
      "description": "Returns the ID of the currently authenticated user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "integer"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/referrals": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "List referrals",
      "description": "Returns the current user's referrals over a date range with pagination. The dynamic path segment is a built querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        },
        {
          "name": "marker",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination marker"
        },
        {
          "name": "onlyPerformers",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Only referred performers/creators"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "hasMore": {
                        "type": "boolean"
                      },
                      "list": {
                        "type": "array"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/settings/messages": {
    "patch": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update message settings",
      "description": "Updates the current user's messaging settings. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; message-settings fields not statically visible"
      }
    }
  },
  "/api2/v2/users/me/settings/{section}": {
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update user settings section",
      "description": "Replaces the settings for a specific settings section of the current user. The section key is the path param and the settings payload is the body. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "section",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Settings section/type key (e.g. messages, story, streams)"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; settings payload for the section"
      }
    }
  },
  "/api2/v2/users/me/settings/{settings_section}": {
    "patch": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update user settings section",
      "description": "Partially updates a named section of the current user's settings. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "settings_section",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Name of the settings section to update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; settings fields not statically visible"
      }
    }
  },
  "/api2/v2/users/me/start-date-model": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get creator start date",
      "description": "Returns the current user's creator/model start-date information. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "startDate": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/stats/messages/{type}": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get messages statistics by type",
      "description": "Returns the current user's messaging statistics for a given type (default 'all') over a date range, paginated and searchable. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "type",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Message stats type/segment (default 'all')"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "limit",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Max number of rows"
        },
        {
          "name": "query",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Search term"
        },
        {
          "name": "offset",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Pagination offset"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/stats/top/fan": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top fans stats",
      "description": "Returns the current user's top-fan statistics over a date range. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "total": {
                        "type": "object",
                        "properties": {
                          "view": {
                            "type": "string"
                          },
                          "avatar": {
                            "type": "null"
                          },
                          "avatarThumbs": {
                            "type": "null"
                          },
                          "header": {
                            "type": "null"
                          },
                          "headerSize": {
                            "type": "null"
                          },
                          "headerThumbs": {
                            "type": "null"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "name": {
                            "type": "string"
                          },
                          "username": {
                            "type": "string"
                          },
                          "canLookStory": {
                            "type": "boolean"
                          },
                          "canCommentStory": {
                            "type": "boolean"
                          },
                          "hasNotViewedStory": {
                            "type": "boolean"
                          },
                          "isVerified": {
                            "type": "boolean"
                          },
                          "canPayInternal": {
                            "type": "boolean"
                          },
                          "hasScheduledStream": {
                            "type": "boolean"
                          },
                          "hasStream": {
                            "type": "boolean"
                          },
                          "hasStories": {
                            "type": "boolean"
                          },
                          "tipsEnabled": {
                            "type": "boolean"
                          },
                          "tipsTextEnabled": {
                            "type": "boolean"
                          },
                          "tipsMin": {
                            "type": "integer"
                          },
                          "tipsMinInternal": {
                            "type": "integer"
                          },
                          "tipsMax": {
                            "type": "integer"
                          },
                          "canEarn": {
                            "type": "boolean"
                          },
                          "canAddSubscriber": {
                            "type": "boolean"
                          },
                          "subscribePrice": {
                            "type": "integer"
                          },
                          "displayName": {
                            "type": "string"
                          },
                          "notice": {
                            "type": "string"
                          },
                          "isActive": {
                            "type": "boolean"
                          },
                          "isRestricted": {
                            "type": "boolean"
                          },
                          "canRestrict": {
                            "type": "boolean"
                          },
                          "subscribedBy": {
                            "type": "boolean"
                          },
                          "subscribedByExpire": {
                            "type": "boolean"
                          },
                          "subscribedByExpireDate": {
                            "type": "string"
                          },
                          "subscribedByAutoprolong": {
                            "type": "boolean"
                          },
                          "subscribedIsExpiredNow": {
                            "type": "boolean"
                          },
                          "currentSubscribePrice": {
                            "type": "integer"
                          },
                          "subscribedOn": {
                            "type": "null"
                          },
                          "subscribedOnExpire": {
                            "type": "boolean"
                          },
                          "subscribedOnExpiredNow": {
                            "type": "boolean"
                          },
                          "subscribedOnDuration": {
                            "type": "string"
                          },
                          "listsStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canReport": {
                            "type": "boolean"
                          },
                          "canReceiveChatMessage": {
                            "type": "boolean"
                          },
                          "hideChat": {
                            "type": "boolean"
                          },
                          "lastSeen": {
                            "type": "string"
                          },
                          "isPerformer": {
                            "type": "boolean"
                          },
                          "isRealPerformer": {
                            "type": "boolean"
                          },
                          "subscribedByData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "string"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "subscribedOnData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "null"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "tipsSumm": {
                                "type": "integer"
                              },
                              "subscribesSumm": {
                                "type": "integer"
                              },
                              "messagesSumm": {
                                "type": "number"
                              },
                              "postsSumm": {
                                "type": "integer"
                              },
                              "streamsSumm": {
                                "type": "integer"
                              },
                              "totalSumm": {
                                "type": "number"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "canTrialSend": {
                            "type": "boolean"
                          },
                          "isBlocked": {
                            "type": "boolean"
                          },
                          "canUnsubscribe": {
                            "type": "boolean"
                          },
                          "isPendingAutoprolong": {
                            "type": "boolean"
                          }
                        }
                      },
                      "subscriptions": {
                        "type": "object",
                        "properties": {
                          "view": {
                            "type": "string"
                          },
                          "avatar": {
                            "type": "null"
                          },
                          "avatarThumbs": {
                            "type": "null"
                          },
                          "header": {
                            "type": "null"
                          },
                          "headerSize": {
                            "type": "null"
                          },
                          "headerThumbs": {
                            "type": "null"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "name": {
                            "type": "string"
                          },
                          "username": {
                            "type": "string"
                          },
                          "canLookStory": {
                            "type": "boolean"
                          },
                          "canCommentStory": {
                            "type": "boolean"
                          },
                          "hasNotViewedStory": {
                            "type": "boolean"
                          },
                          "isVerified": {
                            "type": "boolean"
                          },
                          "canPayInternal": {
                            "type": "boolean"
                          },
                          "hasScheduledStream": {
                            "type": "boolean"
                          },
                          "hasStream": {
                            "type": "boolean"
                          },
                          "hasStories": {
                            "type": "boolean"
                          },
                          "tipsEnabled": {
                            "type": "boolean"
                          },
                          "tipsTextEnabled": {
                            "type": "boolean"
                          },
                          "tipsMin": {
                            "type": "integer"
                          },
                          "tipsMinInternal": {
                            "type": "integer"
                          },
                          "tipsMax": {
                            "type": "integer"
                          },
                          "canEarn": {
                            "type": "boolean"
                          },
                          "canAddSubscriber": {
                            "type": "boolean"
                          },
                          "subscribePrice": {
                            "type": "integer"
                          },
                          "displayName": {
                            "type": "string"
                          },
                          "notice": {
                            "type": "string"
                          },
                          "isActive": {
                            "type": "boolean"
                          },
                          "isRestricted": {
                            "type": "boolean"
                          },
                          "canRestrict": {
                            "type": "boolean"
                          },
                          "subscribedBy": {
                            "type": "boolean"
                          },
                          "subscribedByExpire": {
                            "type": "boolean"
                          },
                          "subscribedByExpireDate": {
                            "type": "string"
                          },
                          "subscribedByAutoprolong": {
                            "type": "boolean"
                          },
                          "subscribedIsExpiredNow": {
                            "type": "boolean"
                          },
                          "currentSubscribePrice": {
                            "type": "integer"
                          },
                          "subscribedOn": {
                            "type": "null"
                          },
                          "subscribedOnExpire": {
                            "type": "boolean"
                          },
                          "subscribedOnExpiredNow": {
                            "type": "boolean"
                          },
                          "subscribedOnDuration": {
                            "type": "string"
                          },
                          "listsStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canReport": {
                            "type": "boolean"
                          },
                          "canReceiveChatMessage": {
                            "type": "boolean"
                          },
                          "hideChat": {
                            "type": "boolean"
                          },
                          "lastSeen": {
                            "type": "string"
                          },
                          "isPerformer": {
                            "type": "boolean"
                          },
                          "isRealPerformer": {
                            "type": "boolean"
                          },
                          "subscribedByData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "string"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "subscribedOnData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "null"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "tipsSumm": {
                                "type": "integer"
                              },
                              "subscribesSumm": {
                                "type": "integer"
                              },
                              "messagesSumm": {
                                "type": "number"
                              },
                              "postsSumm": {
                                "type": "integer"
                              },
                              "streamsSumm": {
                                "type": "integer"
                              },
                              "totalSumm": {
                                "type": "number"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "canTrialSend": {
                            "type": "boolean"
                          },
                          "isBlocked": {
                            "type": "boolean"
                          },
                          "canUnsubscribe": {
                            "type": "boolean"
                          },
                          "isPendingAutoprolong": {
                            "type": "boolean"
                          }
                        }
                      },
                      "tips": {
                        "type": "object",
                        "properties": {
                          "view": {
                            "type": "string"
                          },
                          "avatar": {
                            "type": "null"
                          },
                          "avatarThumbs": {
                            "type": "null"
                          },
                          "header": {
                            "type": "null"
                          },
                          "headerSize": {
                            "type": "null"
                          },
                          "headerThumbs": {
                            "type": "null"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "name": {
                            "type": "string"
                          },
                          "username": {
                            "type": "string"
                          },
                          "canLookStory": {
                            "type": "boolean"
                          },
                          "canCommentStory": {
                            "type": "boolean"
                          },
                          "hasNotViewedStory": {
                            "type": "boolean"
                          },
                          "isVerified": {
                            "type": "boolean"
                          },
                          "canPayInternal": {
                            "type": "boolean"
                          },
                          "hasScheduledStream": {
                            "type": "boolean"
                          },
                          "hasStream": {
                            "type": "boolean"
                          },
                          "hasStories": {
                            "type": "boolean"
                          },
                          "tipsEnabled": {
                            "type": "boolean"
                          },
                          "tipsTextEnabled": {
                            "type": "boolean"
                          },
                          "tipsMin": {
                            "type": "integer"
                          },
                          "tipsMinInternal": {
                            "type": "integer"
                          },
                          "tipsMax": {
                            "type": "integer"
                          },
                          "canEarn": {
                            "type": "boolean"
                          },
                          "canAddSubscriber": {
                            "type": "boolean"
                          },
                          "subscribePrice": {
                            "type": "integer"
                          },
                          "displayName": {
                            "type": "string"
                          },
                          "notice": {
                            "type": "string"
                          },
                          "isActive": {
                            "type": "boolean"
                          },
                          "isRestricted": {
                            "type": "boolean"
                          },
                          "canRestrict": {
                            "type": "boolean"
                          },
                          "subscribedBy": {
                            "type": "boolean"
                          },
                          "subscribedByExpire": {
                            "type": "boolean"
                          },
                          "subscribedByExpireDate": {
                            "type": "string"
                          },
                          "subscribedByAutoprolong": {
                            "type": "boolean"
                          },
                          "subscribedIsExpiredNow": {
                            "type": "boolean"
                          },
                          "currentSubscribePrice": {
                            "type": "integer"
                          },
                          "subscribedOn": {
                            "type": "boolean"
                          },
                          "subscribedOnExpire": {
                            "type": "boolean"
                          },
                          "subscribedOnExpiredNow": {
                            "type": "boolean"
                          },
                          "subscribedOnDuration": {
                            "type": "string"
                          },
                          "listsStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canReport": {
                            "type": "boolean"
                          },
                          "canReceiveChatMessage": {
                            "type": "boolean"
                          },
                          "hideChat": {
                            "type": "boolean"
                          },
                          "lastSeen": {
                            "type": "string"
                          },
                          "isPerformer": {
                            "type": "boolean"
                          },
                          "isRealPerformer": {
                            "type": "boolean"
                          },
                          "subscribedByData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "string"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "subscribedOnData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "string"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "tipsSumm": {
                                "type": "number"
                              },
                              "subscribesSumm": {
                                "type": "integer"
                              },
                              "messagesSumm": {
                                "type": "number"
                              },
                              "postsSumm": {
                                "type": "integer"
                              },
                              "streamsSumm": {
                                "type": "integer"
                              },
                              "totalSumm": {
                                "type": "number"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "canTrialSend": {
                            "type": "boolean"
                          },
                          "isBlocked": {
                            "type": "boolean"
                          },
                          "canUnsubscribe": {
                            "type": "boolean"
                          },
                          "isPendingAutoprolong": {
                            "type": "boolean"
                          }
                        }
                      },
                      "messages": {
                        "type": "object",
                        "properties": {
                          "view": {
                            "type": "string"
                          },
                          "avatar": {
                            "type": "null"
                          },
                          "avatarThumbs": {
                            "type": "null"
                          },
                          "header": {
                            "type": "null"
                          },
                          "headerSize": {
                            "type": "null"
                          },
                          "headerThumbs": {
                            "type": "null"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "name": {
                            "type": "string"
                          },
                          "username": {
                            "type": "string"
                          },
                          "canLookStory": {
                            "type": "boolean"
                          },
                          "canCommentStory": {
                            "type": "boolean"
                          },
                          "hasNotViewedStory": {
                            "type": "boolean"
                          },
                          "isVerified": {
                            "type": "boolean"
                          },
                          "canPayInternal": {
                            "type": "boolean"
                          },
                          "hasScheduledStream": {
                            "type": "boolean"
                          },
                          "hasStream": {
                            "type": "boolean"
                          },
                          "hasStories": {
                            "type": "boolean"
                          },
                          "tipsEnabled": {
                            "type": "boolean"
                          },
                          "tipsTextEnabled": {
                            "type": "boolean"
                          },
                          "tipsMin": {
                            "type": "integer"
                          },
                          "tipsMinInternal": {
                            "type": "integer"
                          },
                          "tipsMax": {
                            "type": "integer"
                          },
                          "canEarn": {
                            "type": "boolean"
                          },
                          "canAddSubscriber": {
                            "type": "boolean"
                          },
                          "subscribePrice": {
                            "type": "integer"
                          },
                          "displayName": {
                            "type": "string"
                          },
                          "notice": {
                            "type": "string"
                          },
                          "isActive": {
                            "type": "boolean"
                          },
                          "isRestricted": {
                            "type": "boolean"
                          },
                          "canRestrict": {
                            "type": "boolean"
                          },
                          "subscribedBy": {
                            "type": "boolean"
                          },
                          "subscribedByExpire": {
                            "type": "boolean"
                          },
                          "subscribedByExpireDate": {
                            "type": "string"
                          },
                          "subscribedByAutoprolong": {
                            "type": "boolean"
                          },
                          "subscribedIsExpiredNow": {
                            "type": "boolean"
                          },
                          "currentSubscribePrice": {
                            "type": "integer"
                          },
                          "subscribedOn": {
                            "type": "null"
                          },
                          "subscribedOnExpire": {
                            "type": "boolean"
                          },
                          "subscribedOnExpiredNow": {
                            "type": "boolean"
                          },
                          "subscribedOnDuration": {
                            "type": "string"
                          },
                          "listsStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canReport": {
                            "type": "boolean"
                          },
                          "canReceiveChatMessage": {
                            "type": "boolean"
                          },
                          "hideChat": {
                            "type": "boolean"
                          },
                          "lastSeen": {
                            "type": "string"
                          },
                          "isPerformer": {
                            "type": "boolean"
                          },
                          "isRealPerformer": {
                            "type": "boolean"
                          },
                          "subscribedByData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "string"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "subscribedOnData": {
                            "type": "object",
                            "properties": {
                              "price": {
                                "type": "integer"
                              },
                              "newPrice": {
                                "type": "integer"
                              },
                              "regularPrice": {
                                "type": "integer"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "discountPercent": {
                                "type": "integer"
                              },
                              "discountPeriod": {
                                "type": "integer"
                              },
                              "subscribeAt": {
                                "type": "string"
                              },
                              "expiredAt": {
                                "type": "string"
                              },
                              "renewedAt": {
                                "type": "null"
                              },
                              "discountFinishedAt": {
                                "type": "null"
                              },
                              "discountStartedAt": {
                                "type": "null"
                              },
                              "status": {
                                "type": "null"
                              },
                              "isMuted": {
                                "type": "boolean"
                              },
                              "unsubscribeReason": {
                                "type": "string"
                              },
                              "duration": {
                                "type": "string"
                              },
                              "tipsSumm": {
                                "type": "integer"
                              },
                              "subscribesSumm": {
                                "type": "integer"
                              },
                              "messagesSumm": {
                                "type": "number"
                              },
                              "postsSumm": {
                                "type": "integer"
                              },
                              "streamsSumm": {
                                "type": "integer"
                              },
                              "totalSumm": {
                                "type": "number"
                              },
                              "subscribes": {
                                "type": "array"
                              },
                              "hasActivePaidSubscriptions": {
                                "type": "boolean"
                              }
                            }
                          },
                          "canTrialSend": {
                            "type": "boolean"
                          },
                          "isBlocked": {
                            "type": "boolean"
                          },
                          "canUnsubscribe": {
                            "type": "boolean"
                          },
                          "isPendingAutoprolong": {
                            "type": "boolean"
                          }
                        }
                      },
                      "streams": {
                        "type": "null"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/stats/top/message": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top messages stats",
      "description": "Returns statistics on the current user's top-performing messages over a date range. The `{id}` in path_raw is the appended querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "purchases": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "integer"
                          },
                          "date": {
                            "type": "string"
                          },
                          "responseType": {
                            "type": "string"
                          },
                          "text": {
                            "type": "string"
                          },
                          "rawText": {
                            "type": "string"
                          },
                          "giphyId": {
                            "type": "null"
                          },
                          "isFree": {
                            "type": "boolean"
                          },
                          "isMediaReady": {
                            "type": "boolean"
                          },
                          "mediaCount": {
                            "type": "integer"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "previews": {
                            "type": "array"
                          },
                          "isTip": {
                            "type": "boolean"
                          },
                          "isReportedByMe": {
                            "type": "boolean"
                          },
                          "viewedCount": {
                            "type": "integer"
                          },
                          "sentCount": {
                            "type": "integer"
                          },
                          "isCanceled": {
                            "type": "boolean"
                          },
                          "template": {
                            "type": "string"
                          },
                          "canUnsend": {
                            "type": "boolean"
                          },
                          "unsendSeconds": {
                            "type": "integer"
                          },
                          "price": {
                            "type": "string"
                          },
                          "purchasedCount": {
                            "type": "integer"
                          },
                          "canSendMessageToBuyers": {
                            "type": "boolean"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/stats/top/post": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top posts statistics",
      "description": "Returns the current user's top-performing posts statistics for a date range. Sibling calls fetch top story/stream/stream stats. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Start of the date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "End of the date range"
        },
        {
          "name": "skip_users",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Whether to omit expanded user objects (set to 'all')"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "purchases": {
                        "type": "null"
                      },
                      "tips": {
                        "type": "object",
                        "properties": {
                          "author": {
                            "type": "object",
                            "properties": {
                              "view": {
                                "type": "string"
                              },
                              "avatar": {
                                "type": "string"
                              },
                              "avatarThumbs": {
                                "type": "object"
                              },
                              "header": {
                                "type": "string"
                              },
                              "headerSize": {
                                "type": "object"
                              },
                              "headerThumbs": {
                                "type": "object"
                              },
                              "id": {
                                "type": "integer"
                              },
                              "name": {
                                "type": "string"
                              },
                              "username": {
                                "type": "string"
                              },
                              "canLookStory": {
                                "type": "boolean"
                              },
                              "canCommentStory": {
                                "type": "boolean"
                              },
                              "hasNotViewedStory": {
                                "type": "boolean"
                              },
                              "isVerified": {
                                "type": "boolean"
                              },
                              "canPayInternal": {
                                "type": "boolean"
                              },
                              "hasScheduledStream": {
                                "type": "boolean"
                              },
                              "hasStream": {
                                "type": "boolean"
                              },
                              "hasStories": {
                                "type": "boolean"
                              },
                              "tipsEnabled": {
                                "type": "boolean"
                              },
                              "tipsTextEnabled": {
                                "type": "boolean"
                              },
                              "tipsMin": {
                                "type": "integer"
                              },
                              "tipsMinInternal": {
                                "type": "integer"
                              },
                              "tipsMax": {
                                "type": "integer"
                              },
                              "canEarn": {
                                "type": "boolean"
                              },
                              "canAddSubscriber": {
                                "type": "boolean"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "hasStripe": {
                                "type": "boolean"
                              },
                              "isStripeExist": {
                                "type": "boolean"
                              },
                              "subscriptionBundles": {
                                "type": "array"
                              },
                              "canSendChatToAll": {
                                "type": "boolean"
                              },
                              "creditsMin": {
                                "type": "integer"
                              },
                              "creditsMax": {
                                "type": "integer"
                              },
                              "isPaywallPassed": {
                                "type": "boolean"
                              },
                              "creditsMinAlternatives": {
                                "type": "integer"
                              },
                              "payPalStatus": {
                                "type": "array"
                              },
                              "canCreateLists": {
                                "type": "boolean"
                              },
                              "showMediaCount": {
                                "type": "boolean"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribedBy": {
                                "type": "boolean"
                              },
                              "canTrialSend": {
                                "type": "boolean"
                              }
                            }
                          },
                          "responseType": {
                            "type": "string"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "postedAt": {
                            "type": "string"
                          },
                          "postedAtPrecise": {
                            "type": "string"
                          },
                          "text": {
                            "type": "string"
                          },
                          "isMarkdownDisabled": {
                            "type": "boolean"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "canComment": {
                            "type": "boolean"
                          },
                          "canEdit": {
                            "type": "boolean"
                          },
                          "favoritesCount": {
                            "type": "integer"
                          },
                          "mediaCount": {
                            "type": "integer"
                          },
                          "isMediaReady": {
                            "type": "boolean"
                          },
                          "isOpened": {
                            "type": "boolean"
                          },
                          "canToggleFavorite": {
                            "type": "boolean"
                          },
                          "stats": {
                            "type": "object",
                            "properties": {
                              "isAvailable": {
                                "type": "boolean"
                              },
                              "hasStats": {
                                "type": "boolean"
                              },
                              "hasVideo": {
                                "type": "boolean"
                              },
                              "hasAudio": {
                                "type": "boolean"
                              },
                              "lookCount": {
                                "type": "integer"
                              },
                              "uniqueLookCount": {
                                "type": "integer"
                              },
                              "uniqueLookChart": {
                                "type": "array"
                              },
                              "lookChart": {
                                "type": "array"
                              },
                              "lookDuration": {
                                "type": "integer"
                              },
                              "lookDurationAverage": {
                                "type": "number"
                              },
                              "likeCount": {
                                "type": "integer"
                              },
                              "likeChart": {
                                "type": "array"
                              },
                              "commentCount": {
                                "type": "integer"
                              },
                              "commentChart": {
                                "type": "array"
                              },
                              "tipCount": {
                                "type": "integer"
                              },
                              "tipChart": {
                                "type": "array"
                              },
                              "tipSum": {
                                "type": "number"
                              },
                              "purchasedCount": {
                                "type": "integer"
                              },
                              "purchasedSumm": {
                                "type": "integer"
                              },
                              "videoPlayCount": {
                                "type": "integer"
                              },
                              "videoPlayDuration": {
                                "type": "integer"
                              },
                              "videoPlayDurationAverage": {
                                "type": "number"
                              }
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "rawText": {
                            "type": "string"
                          },
                          "tweetSend": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canViewMedia": {
                            "type": "boolean"
                          },
                          "labelStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "views": {
                        "type": "object",
                        "properties": {
                          "author": {
                            "type": "object",
                            "properties": {
                              "view": {
                                "type": "string"
                              },
                              "avatar": {
                                "type": "string"
                              },
                              "avatarThumbs": {
                                "type": "object"
                              },
                              "header": {
                                "type": "string"
                              },
                              "headerSize": {
                                "type": "object"
                              },
                              "headerThumbs": {
                                "type": "object"
                              },
                              "id": {
                                "type": "integer"
                              },
                              "name": {
                                "type": "string"
                              },
                              "username": {
                                "type": "string"
                              },
                              "canLookStory": {
                                "type": "boolean"
                              },
                              "canCommentStory": {
                                "type": "boolean"
                              },
                              "hasNotViewedStory": {
                                "type": "boolean"
                              },
                              "isVerified": {
                                "type": "boolean"
                              },
                              "canPayInternal": {
                                "type": "boolean"
                              },
                              "hasScheduledStream": {
                                "type": "boolean"
                              },
                              "hasStream": {
                                "type": "boolean"
                              },
                              "hasStories": {
                                "type": "boolean"
                              },
                              "tipsEnabled": {
                                "type": "boolean"
                              },
                              "tipsTextEnabled": {
                                "type": "boolean"
                              },
                              "tipsMin": {
                                "type": "integer"
                              },
                              "tipsMinInternal": {
                                "type": "integer"
                              },
                              "tipsMax": {
                                "type": "integer"
                              },
                              "canEarn": {
                                "type": "boolean"
                              },
                              "canAddSubscriber": {
                                "type": "boolean"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "hasStripe": {
                                "type": "boolean"
                              },
                              "isStripeExist": {
                                "type": "boolean"
                              },
                              "subscriptionBundles": {
                                "type": "array"
                              },
                              "canSendChatToAll": {
                                "type": "boolean"
                              },
                              "creditsMin": {
                                "type": "integer"
                              },
                              "creditsMax": {
                                "type": "integer"
                              },
                              "isPaywallPassed": {
                                "type": "boolean"
                              },
                              "creditsMinAlternatives": {
                                "type": "integer"
                              },
                              "payPalStatus": {
                                "type": "array"
                              },
                              "canCreateLists": {
                                "type": "boolean"
                              },
                              "showMediaCount": {
                                "type": "boolean"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribedBy": {
                                "type": "boolean"
                              },
                              "canTrialSend": {
                                "type": "boolean"
                              }
                            }
                          },
                          "responseType": {
                            "type": "string"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "postedAt": {
                            "type": "string"
                          },
                          "postedAtPrecise": {
                            "type": "string"
                          },
                          "text": {
                            "type": "string"
                          },
                          "isMarkdownDisabled": {
                            "type": "boolean"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "canComment": {
                            "type": "boolean"
                          },
                          "canEdit": {
                            "type": "boolean"
                          },
                          "isPinned": {
                            "type": "boolean"
                          },
                          "favoritesCount": {
                            "type": "integer"
                          },
                          "mediaCount": {
                            "type": "integer"
                          },
                          "isMediaReady": {
                            "type": "boolean"
                          },
                          "isOpened": {
                            "type": "boolean"
                          },
                          "canToggleFavorite": {
                            "type": "boolean"
                          },
                          "stats": {
                            "type": "object",
                            "properties": {
                              "isAvailable": {
                                "type": "boolean"
                              },
                              "hasStats": {
                                "type": "boolean"
                              },
                              "hasVideo": {
                                "type": "boolean"
                              },
                              "hasAudio": {
                                "type": "boolean"
                              },
                              "lookCount": {
                                "type": "integer"
                              },
                              "uniqueLookCount": {
                                "type": "integer"
                              },
                              "uniqueLookChart": {
                                "type": "array"
                              },
                              "lookChart": {
                                "type": "array"
                              },
                              "lookDuration": {
                                "type": "integer"
                              },
                              "lookDurationAverage": {
                                "type": "number"
                              },
                              "likeCount": {
                                "type": "integer"
                              },
                              "likeChart": {
                                "type": "array"
                              },
                              "commentCount": {
                                "type": "integer"
                              },
                              "commentChart": {
                                "type": "array"
                              },
                              "tipCount": {
                                "type": "integer"
                              },
                              "tipChart": {
                                "type": "array"
                              },
                              "tipSum": {
                                "type": "number"
                              },
                              "purchasedCount": {
                                "type": "integer"
                              },
                              "purchasedSumm": {
                                "type": "integer"
                              },
                              "videoPlayCount": {
                                "type": "integer"
                              },
                              "videoPlayDuration": {
                                "type": "integer"
                              },
                              "videoPlayDurationAverage": {
                                "type": "number"
                              }
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "rawText": {
                            "type": "string"
                          },
                          "tweetSend": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canViewMedia": {
                            "type": "boolean"
                          },
                          "labelStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "likes": {
                        "type": "object",
                        "properties": {
                          "author": {
                            "type": "object",
                            "properties": {
                              "view": {
                                "type": "string"
                              },
                              "avatar": {
                                "type": "string"
                              },
                              "avatarThumbs": {
                                "type": "object"
                              },
                              "header": {
                                "type": "string"
                              },
                              "headerSize": {
                                "type": "object"
                              },
                              "headerThumbs": {
                                "type": "object"
                              },
                              "id": {
                                "type": "integer"
                              },
                              "name": {
                                "type": "string"
                              },
                              "username": {
                                "type": "string"
                              },
                              "canLookStory": {
                                "type": "boolean"
                              },
                              "canCommentStory": {
                                "type": "boolean"
                              },
                              "hasNotViewedStory": {
                                "type": "boolean"
                              },
                              "isVerified": {
                                "type": "boolean"
                              },
                              "canPayInternal": {
                                "type": "boolean"
                              },
                              "hasScheduledStream": {
                                "type": "boolean"
                              },
                              "hasStream": {
                                "type": "boolean"
                              },
                              "hasStories": {
                                "type": "boolean"
                              },
                              "tipsEnabled": {
                                "type": "boolean"
                              },
                              "tipsTextEnabled": {
                                "type": "boolean"
                              },
                              "tipsMin": {
                                "type": "integer"
                              },
                              "tipsMinInternal": {
                                "type": "integer"
                              },
                              "tipsMax": {
                                "type": "integer"
                              },
                              "canEarn": {
                                "type": "boolean"
                              },
                              "canAddSubscriber": {
                                "type": "boolean"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "hasStripe": {
                                "type": "boolean"
                              },
                              "isStripeExist": {
                                "type": "boolean"
                              },
                              "subscriptionBundles": {
                                "type": "array"
                              },
                              "canSendChatToAll": {
                                "type": "boolean"
                              },
                              "creditsMin": {
                                "type": "integer"
                              },
                              "creditsMax": {
                                "type": "integer"
                              },
                              "isPaywallPassed": {
                                "type": "boolean"
                              },
                              "creditsMinAlternatives": {
                                "type": "integer"
                              },
                              "payPalStatus": {
                                "type": "array"
                              },
                              "canCreateLists": {
                                "type": "boolean"
                              },
                              "showMediaCount": {
                                "type": "boolean"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribedBy": {
                                "type": "boolean"
                              },
                              "canTrialSend": {
                                "type": "boolean"
                              }
                            }
                          },
                          "responseType": {
                            "type": "string"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "postedAt": {
                            "type": "string"
                          },
                          "postedAtPrecise": {
                            "type": "string"
                          },
                          "text": {
                            "type": "string"
                          },
                          "isMarkdownDisabled": {
                            "type": "boolean"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "canComment": {
                            "type": "boolean"
                          },
                          "canEdit": {
                            "type": "boolean"
                          },
                          "isPinned": {
                            "type": "boolean"
                          },
                          "favoritesCount": {
                            "type": "integer"
                          },
                          "mediaCount": {
                            "type": "integer"
                          },
                          "isMediaReady": {
                            "type": "boolean"
                          },
                          "isOpened": {
                            "type": "boolean"
                          },
                          "canToggleFavorite": {
                            "type": "boolean"
                          },
                          "stats": {
                            "type": "object",
                            "properties": {
                              "isAvailable": {
                                "type": "boolean"
                              },
                              "hasStats": {
                                "type": "boolean"
                              },
                              "hasVideo": {
                                "type": "boolean"
                              },
                              "hasAudio": {
                                "type": "boolean"
                              },
                              "lookCount": {
                                "type": "integer"
                              },
                              "uniqueLookCount": {
                                "type": "integer"
                              },
                              "uniqueLookChart": {
                                "type": "array"
                              },
                              "lookChart": {
                                "type": "array"
                              },
                              "lookDuration": {
                                "type": "integer"
                              },
                              "lookDurationAverage": {
                                "type": "number"
                              },
                              "likeCount": {
                                "type": "integer"
                              },
                              "likeChart": {
                                "type": "array"
                              },
                              "commentCount": {
                                "type": "integer"
                              },
                              "commentChart": {
                                "type": "array"
                              },
                              "tipCount": {
                                "type": "integer"
                              },
                              "tipChart": {
                                "type": "array"
                              },
                              "tipSum": {
                                "type": "number"
                              },
                              "purchasedCount": {
                                "type": "integer"
                              },
                              "purchasedSumm": {
                                "type": "integer"
                              },
                              "videoPlayCount": {
                                "type": "integer"
                              },
                              "videoPlayDuration": {
                                "type": "integer"
                              },
                              "videoPlayDurationAverage": {
                                "type": "number"
                              }
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "rawText": {
                            "type": "string"
                          },
                          "tweetSend": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canViewMedia": {
                            "type": "boolean"
                          },
                          "labelStates": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          }
                        }
                      },
                      "comments": {
                        "type": "object",
                        "properties": {
                          "author": {
                            "type": "object",
                            "properties": {
                              "view": {
                                "type": "string"
                              },
                              "avatar": {
                                "type": "string"
                              },
                              "avatarThumbs": {
                                "type": "object"
                              },
                              "header": {
                                "type": "string"
                              },
                              "headerSize": {
                                "type": "object"
                              },
                              "headerThumbs": {
                                "type": "object"
                              },
                              "id": {
                                "type": "integer"
                              },
                              "name": {
                                "type": "string"
                              },
                              "username": {
                                "type": "string"
                              },
                              "canLookStory": {
                                "type": "boolean"
                              },
                              "canCommentStory": {
                                "type": "boolean"
                              },
                              "hasNotViewedStory": {
                                "type": "boolean"
                              },
                              "isVerified": {
                                "type": "boolean"
                              },
                              "canPayInternal": {
                                "type": "boolean"
                              },
                              "hasScheduledStream": {
                                "type": "boolean"
                              },
                              "hasStream": {
                                "type": "boolean"
                              },
                              "hasStories": {
                                "type": "boolean"
                              },
                              "tipsEnabled": {
                                "type": "boolean"
                              },
                              "tipsTextEnabled": {
                                "type": "boolean"
                              },
                              "tipsMin": {
                                "type": "integer"
                              },
                              "tipsMinInternal": {
                                "type": "integer"
                              },
                              "tipsMax": {
                                "type": "integer"
                              },
                              "canEarn": {
                                "type": "boolean"
                              },
                              "canAddSubscriber": {
                                "type": "boolean"
                              },
                              "subscribePrice": {
                                "type": "integer"
                              },
                              "hasStripe": {
                                "type": "boolean"
                              },
                              "isStripeExist": {
                                "type": "boolean"
                              },
                              "subscriptionBundles": {
                                "type": "array"
                              },
                              "canSendChatToAll": {
                                "type": "boolean"
                              },
                              "creditsMin": {
                                "type": "integer"
                              },
                              "creditsMax": {
                                "type": "integer"
                              },
                              "isPaywallPassed": {
                                "type": "boolean"
                              },
                              "creditsMinAlternatives": {
                                "type": "integer"
                              },
                              "payPalStatus": {
                                "type": "array"
                              },
                              "canCreateLists": {
                                "type": "boolean"
                              },
                              "showMediaCount": {
                                "type": "boolean"
                              },
                              "showPostsInFeed": {
                                "type": "boolean"
                              },
                              "subscribedBy": {
                                "type": "boolean"
                              },
                              "canTrialSend": {
                                "type": "boolean"
                              }
                            }
                          },
                          "responseType": {
                            "type": "string"
                          },
                          "id": {
                            "type": "integer"
                          },
                          "postedAt": {
                            "type": "string"
                          },
                          "postedAtPrecise": {
                            "type": "string"
                          },
                          "isMarkdownDisabled": {
                            "type": "boolean"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "canComment": {
                            "type": "boolean"
                          },
                          "canEdit": {
                            "type": "boolean"
                          },
                          "favoritesCount": {
                            "type": "integer"
                          },
                          "mediaCount": {
                            "type": "integer"
                          },
                          "isMediaReady": {
                            "type": "boolean"
                          },
                          "isOpened": {
                            "type": "boolean"
                          },
                          "canToggleFavorite": {
                            "type": "boolean"
                          },
                          "stats": {
                            "type": "object",
                            "properties": {
                              "isAvailable": {
                                "type": "boolean"
                              },
                              "hasStats": {
                                "type": "boolean"
                              },
                              "hasVideo": {
                                "type": "boolean"
                              },
                              "hasAudio": {
                                "type": "boolean"
                              },
                              "lookCount": {
                                "type": "integer"
                              },
                              "uniqueLookCount": {
                                "type": "integer"
                              },
                              "uniqueLookChart": {
                                "type": "array"
                              },
                              "lookChart": {
                                "type": "array"
                              },
                              "lookDuration": {
                                "type": "integer"
                              },
                              "lookDurationAverage": {
                                "type": "number"
                              },
                              "likeCount": {
                                "type": "integer"
                              },
                              "likeChart": {
                                "type": "array"
                              },
                              "commentCount": {
                                "type": "integer"
                              },
                              "commentChart": {
                                "type": "array"
                              },
                              "tipCount": {
                                "type": "integer"
                              },
                              "tipChart": {
                                "type": "array"
                              },
                              "tipSum": {
                                "type": "integer"
                              },
                              "purchasedCount": {
                                "type": "integer"
                              },
                              "purchasedSumm": {
                                "type": "integer"
                              }
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "tweetSend": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "canViewMedia": {
                            "type": "boolean"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/stats/top/story": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top stories stats",
      "description": "Retrieves top-performing story statistics over a date range. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Start of date range"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "End of date range"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "tips": {
                        "type": "null"
                      },
                      "views": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "integer"
                          },
                          "userId": {
                            "type": "integer"
                          },
                          "isReady": {
                            "type": "boolean"
                          },
                          "hasPost": {
                            "type": "boolean"
                          },
                          "isWatched": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "createdAt": {
                            "type": "string"
                          },
                          "canvasHeight": {
                            "type": "integer"
                          },
                          "canvasWidth": {
                            "type": "integer"
                          },
                          "question": {
                            "type": "object",
                            "properties": {
                              "entity": {
                                "type": "object"
                              },
                              "type": {
                                "type": "string"
                              },
                              "positions": {
                                "type": "object"
                              }
                            }
                          },
                          "viewersCount": {
                            "type": "integer"
                          },
                          "viewers": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "isHighlightCover": {
                            "type": "boolean"
                          },
                          "isLastInHighlight": {
                            "type": "boolean"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "tipsAmountRaw": {
                            "type": "integer"
                          },
                          "tipsCount": {
                            "type": "integer"
                          },
                          "likesCount": {
                            "type": "integer"
                          },
                          "releaseForms": {
                            "type": "array"
                          }
                        }
                      },
                      "likes": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "integer"
                          },
                          "userId": {
                            "type": "integer"
                          },
                          "isReady": {
                            "type": "boolean"
                          },
                          "hasPost": {
                            "type": "boolean"
                          },
                          "isWatched": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "createdAt": {
                            "type": "string"
                          },
                          "canvasHeight": {
                            "type": "integer"
                          },
                          "canvasWidth": {
                            "type": "integer"
                          },
                          "question": {
                            "type": "object",
                            "properties": {
                              "entity": {
                                "type": "object"
                              },
                              "type": {
                                "type": "string"
                              },
                              "positions": {
                                "type": "object"
                              }
                            }
                          },
                          "viewersCount": {
                            "type": "integer"
                          },
                          "viewers": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "isHighlightCover": {
                            "type": "boolean"
                          },
                          "isLastInHighlight": {
                            "type": "boolean"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "tipsAmountRaw": {
                            "type": "integer"
                          },
                          "tipsCount": {
                            "type": "integer"
                          },
                          "likesCount": {
                            "type": "integer"
                          },
                          "releaseForms": {
                            "type": "array"
                          }
                        }
                      },
                      "comments": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "integer"
                          },
                          "userId": {
                            "type": "integer"
                          },
                          "isReady": {
                            "type": "boolean"
                          },
                          "hasPost": {
                            "type": "boolean"
                          },
                          "isWatched": {
                            "type": "boolean"
                          },
                          "media": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "createdAt": {
                            "type": "string"
                          },
                          "canvasHeight": {
                            "type": "integer"
                          },
                          "canvasWidth": {
                            "type": "integer"
                          },
                          "question": {
                            "type": "object",
                            "properties": {
                              "entity": {
                                "type": "object"
                              },
                              "type": {
                                "type": "string"
                              },
                              "positions": {
                                "type": "object"
                              }
                            }
                          },
                          "viewersCount": {
                            "type": "integer"
                          },
                          "viewers": {
                            "type": "array",
                            "items": {
                              "type": "object"
                            }
                          },
                          "commentsCount": {
                            "type": "integer"
                          },
                          "canDelete": {
                            "type": "boolean"
                          },
                          "isHighlightCover": {
                            "type": "boolean"
                          },
                          "isLastInHighlight": {
                            "type": "boolean"
                          },
                          "tipsAmount": {
                            "type": "string"
                          },
                          "tipsAmountRaw": {
                            "type": "integer"
                          },
                          "tipsCount": {
                            "type": "integer"
                          },
                          "likesCount": {
                            "type": "integer"
                          },
                          "releaseForms": {
                            "type": "array"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/stats/top/stream": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get top streams stats",
      "description": "Returns the current user's top-performing streams statistics for a date range. The dynamic suffix in path_raw is the querystring. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "startDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range start date"
        },
        {
          "name": "endDate",
          "in": "query",
          "required": false,
          "schema": {
            "type": "string"
          },
          "description": "Range end date"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "purchases": {
                        "type": "null"
                      },
                      "tips": {
                        "type": "null"
                      },
                      "views": {
                        "type": "null"
                      },
                      "likes": {
                        "type": "null"
                      },
                      "comments": {
                        "type": "null"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/strong_otp_codes": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get OTP backup codes",
      "description": "Returns the current user's strong OTP (backup/recovery) codes. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/me/validate-data": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Validate current user data",
      "description": "Validates submitted profile/account data for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/media/drm/certificate": {
    "get": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Get DRM certificate",
      "description": "Retrieves the DRM certificate used for protected media playback. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "string"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/notifications/settings/tabs-order": {
    "get": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Get notification tabs order",
      "description": "Returns the user's configured ordering of notification tabs. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Save notification tabs order",
      "description": "Saves the ordering of the notification settings tabs. A GET on the same path retrieves the current order. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; tab order payload, not statically visible"
      }
    }
  },
  "/api2/v2/users/notifications/{notification_id}/read": {
    "post": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Mark notification as read",
      "description": "Marks a single notification as read by its id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "notification_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the notification to mark read"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/opensea/nft": {
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Set OpenSea NFT profile item",
      "description": "Updates the OpenSea NFT associated with the user's profile. Sibling calls manage the linked OpenSea wallet and asset listings. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/opensea/wallet": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Disconnect OpenSea wallet",
      "description": "Removes the connected OpenSea crypto wallet from the current user account. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Connect OpenSea wallet",
      "description": "Links an OpenSea (crypto) wallet to the current user account. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; wallet details, not statically visible"
      }
    }
  },
  "/api2/v2/users/otp": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Disable two-factor OTP",
      "description": "Disables two-factor authentication (OTP) for the account using a verification code. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Confirm OTP code",
      "description": "Confirms/enables one-time-password (2FA) by submitting the verification code. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "OTP verification code"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/otp/alternative": {
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Request alternative OTP method",
      "description": "Requests an alternative one-time-password (2FA) delivery method. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/otp/check": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Verify OTP code",
      "description": "Verifies a one-time password code. Grouped with users/otp code/phone/alternative endpoints. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible (likely {code})"
      }
    }
  },
  "/api2/v2/users/otp/code": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Request OTP code",
      "description": "Requests/retrieves a one-time password (OTP) code for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/otp/phone": {
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Enable phone OTP",
      "description": "Enables/requests one-time-password (2FA) delivery via phone for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/password": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Remove account password",
      "description": "Deletes the current user's password (e.g. for social-login-only accounts). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/posts/on-this-day": {
    "get": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Get 'on this day' posts",
      "description": "Retrieves the current user's posts from this date in previous years ('on this day' memories). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/profile/view": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Record profile view",
      "description": "Records that the current user viewed a profile (paired with users/profile/visit). Retries once on failure. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely target user id"
      }
    }
  },
  "/api2/v2/users/profile/visit": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Record a profile visit",
      "description": "Records a profile visit event; a sibling POST /users/profile/view records profile views. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; visit payload not statically visible"
      }
    }
  },
  "/api2/v2/users/promotions": {
    "get": {
      "tags": [
        "OF API — Promotions"
      ],
      "summary": "Get user promotions",
      "description": "Retrieves promotions available to the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "imageSrc": {
                          "type": "string"
                        },
                        "url": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/push-token/pwa": {
    "put": {
      "tags": [
        "OF API — Notifications"
      ],
      "summary": "Register PWA push token",
      "description": "Registers or updates the web-push (PWA) push notification token for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; push subscription/token payload"
      }
    }
  },
  "/api2/v2/users/recommends/{user_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Dismiss a recommended user",
      "description": "Removes/dismisses a suggested (recommended) user identified by user_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the recommended user to dismiss"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/register": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Register a new user account",
      "description": "Registers a new user account. The request body carries the registration form fields. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; registration fields not statically visible"
      }
    }
  },
  "/api2/v2/users/restore-access": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Restore account access with code",
      "description": "Restores access to a user account using a provided restore/verification code. Sent with a skip429Alert retry config. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "Restore-access code"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/settings/notifications": {
    "patch": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update notification settings",
      "description": "Updates the account's notification settings. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/settings/notifications/transports": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get notification transport settings",
      "description": "Returns the available/enabled notification transport channels (email, push, etc.) for the user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/social/buttons": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get social buttons",
      "description": "Retrieves the current user's configured social media buttons/links. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Add social buttons",
      "description": "Adds social/link buttons to the user's profile using the provided button IDs. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "buttonIds": {
                  "type": "array",
                  "description": "IDs of the social buttons to add"
                }
              }
            }
          }
        },
        "description": "Payload is {buttonIds: e}"
      }
    },
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update social profile buttons",
      "description": "Updates the configuration of the user's social profile buttons. Sibling calls add, reorder, delete and track clicks on these buttons. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/social/buttons/{button_id}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Delete a social button",
      "description": "Deletes a profile social/link button identified by button_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "button_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Id of the social button to delete"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Update a social button",
      "description": "Updates a single social button by id on the user's profile. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "button_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the social button to update"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; button fields not statically visible"
      }
    }
  },
  "/api2/v2/users/social/buttons/{button_id}/click": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Register social button click",
      "description": "Records a click on a user's social button. Part of the profile social-buttons feature. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "button_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the social button clicked"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/social/spotify/anthem": {
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Set Spotify anthem",
      "description": "Sets the user's Spotify profile anthem track. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "anthemId": {
                  "type": "string",
                  "description": "Spotify track ID to set as the anthem"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/social/spotify/artists": {
    "put": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Set top Spotify artists",
      "description": "Sets the user's top Spotify artists shown on their profile. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "topArtistsIds": {
                  "type": "array",
                  "description": "IDs of the top Spotify artists"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/social/spring": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Disconnect Spring integration",
      "description": "Disconnects/removes the user's linked Spring (merch) social integration. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Connect Spring merch account",
      "description": "Connects/saves the user's Spring (merch) social integration (DELETE unlinks it, GET retrieves it). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; Spring integration fields not statically visible"
      }
    }
  },
  "/api2/v2/users/social/{network}": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Disconnect social network",
      "description": "Disconnects/unlinks a social network account (defaults to twitter) from the profile. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "network",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "Social network name (e.g. twitter); defaults to twitter"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/switch/{user_id}": {
    "post": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Switch to connected account",
      "description": "Switches the active session to a connected/linked user account. Defined near users/connect and users/get-auth-token. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the connected account to switch to"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/telegram-link": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get Telegram link info",
      "description": "Returns the Telegram linking information/URL for connecting the account to Telegram. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/terms/confirm": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Confirm terms acceptance",
      "description": "Confirms the user's acceptance of updated terms. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/tickets": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Create a support ticket",
      "description": "Creates a new support ticket for the current user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; ticket subject/message payload"
      }
    }
  },
  "/api2/v2/users/tickets/allowed": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Check support ticket allowed",
      "description": "Checks whether the user is allowed to create a support ticket (part of the users/tickets support module). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/tickets/form_subjects": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get support ticket subjects",
      "description": "Returns the selectable subject options for the support-ticket creation form. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "items": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "id": {
                              "type": "integer"
                            },
                            "title": {
                              "type": "string"
                            },
                            "items": {
                              "type": "array"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/tickets/{ticket_id}": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get support ticket",
      "description": "Retrieves a support ticket by id. Grouped with ticket reply/comments/solve/reopen endpoints. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "ticket_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the support ticket"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/tickets/{ticket_id}/read": {
    "put": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Mark support ticket as read",
      "description": "Marks the given support ticket as read. Part of the users/tickets support module (reply, solve, reopen, comments). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "ticket_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the support ticket"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/tickets/{ticket_id}/reopen": {
    "put": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Reopen a support ticket",
      "description": "Reopens a previously closed support ticket identified by ticket_id. Body carries the reopen data. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "ticket_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the support ticket to reopen"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque data object; fields not statically visible"
      }
    }
  },
  "/api2/v2/users/tickets/{ticket_id}/reply": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Reply to support ticket",
      "description": "Posts a reply to the specified support ticket. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "ticket_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the support ticket"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; reply content not statically visible"
      }
    }
  },
  "/api2/v2/users/tickets/{ticket_id}/solve": {
    "post": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Mark support ticket solved",
      "description": "Marks a user support ticket as solved. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "ticket_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the support ticket"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/ws-auth": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get WebSocket auth token",
      "description": "Returns authentication data/token needed to establish the realtime WebSocket connection. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "object",
                    "properties": {
                      "wsUrl": {
                        "type": "string"
                      },
                      "wsAuthToken": {
                        "type": "string"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/{user_id}/friends/pinned": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get pinned friends",
      "description": "Returns a user's pinned friends. Called as getPinnedFriends({userId}). **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user whose pinned friends to fetch"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/{user_id}/links": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get user's links",
      "description": "Retrieves the profile links configured by a user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user whose links to fetch"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/{user_id}/resubscribe": {
    "post": {
      "tags": [
        "OF API — Subscriptions"
      ],
      "summary": "Resubscribe to a user",
      "description": "Resubscribes to the given user's account. Sibling of users/{id}/subscribe. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user to resubscribe to"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; optional subscription options, not statically visible"
      }
    }
  },
  "/api2/v2/users/{user_id}/shopify/stores": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "List user's Shopify stores",
      "description": "Retrieves the Shopify stores connected to a given user. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user whose Shopify stores are listed"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/users/{user_id}/social/buttons": {
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Get user social buttons",
      "description": "Retrieves the social/link buttons configured on a user's profile. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "user_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the user whose social buttons to fetch"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/vault/lists/sort": {
    "post": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Sort vault lists",
      "description": "Reorders the creator's vault media lists. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object"
            }
          }
        },
        "description": "opaque object; likely ordered ids, not statically visible"
      }
    }
  },
  "/api2/v2/vault/lists/{list_id}": {
    "delete": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Delete vault list",
      "description": "Deletes a vault media list, optionally also clearing its media. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the vault media list"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Get vault media list",
      "description": "Retrieves a single vault media list by id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the vault list"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "patch": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Rename a vault list",
      "description": "Renames a media vault list identified by list id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "list_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the vault list"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "New name for the vault list"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/vault/media/hidden": {
    "put": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Hide vault media",
      "description": "Marks the given vault media items as hidden. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      },
      "requestBody": {
        "content": {
          "application/json": {
            "schema": {
              "type": "object",
              "properties": {
                "mediaIds": {
                  "type": "array",
                  "description": "Ids of the vault media to hide"
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/vault/media/{media_id}/release-forms": {
    "get": {
      "tags": [
        "OF API — Content"
      ],
      "summary": "Get vault media release forms",
      "description": "Returns the release forms attached to a vault media item identified by media_id. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "media_id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ID of the vault media item"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/webauthn/credentials": {
    "delete": {
      "tags": [
        "OF API — User"
      ],
      "summary": "Delete a WebAuthn credential",
      "description": "Removes a registered WebAuthn (passkey/security key) credential for the current user; the credential identifier is sent in the request body. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    },
    "get": {
      "tags": [
        "OF API — User"
      ],
      "summary": "List WebAuthn credentials",
      "description": "Returns the current user's registered WebAuthn (passkey/security key) credentials. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n✓ **Verified live** against a real OnlyFans account (2026-07-30); the `data` schema below is the real response shape.",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response — verified live; `data` is the real shape.",
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "success": {
                    "type": "boolean"
                  },
                  "status_code": {
                    "type": "integer"
                  },
                  "data": {
                    "type": "array"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "/api2/v2/zip/{zip_code}/state": {
    "get": {
      "tags": [
        "OF API — Misc"
      ],
      "summary": "Get state for a ZIP code",
      "description": "Looks up the state/region associated with a given ZIP code, used by payouts address forms. Defined in the payouts/address module. **OnlyFans only** — Fansly accounts are rejected on `/api2/v2/*`.\n\n_Reverse-engineered from the OnlyFans web client (build passthrough) — call shape auto-extracted and may need verification._",
      "parameters": [
        {
          "$ref": "#/components/parameters/ofUserIdHeader"
        },
        {
          "$ref": "#/components/parameters/proxyHeader"
        },
        {
          "name": "zip_code",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          },
          "description": "ZIP/postal code to resolve to a state"
        }
      ],
      "responses": {
        "200": {
          "description": "OnlyFans response (passthrough envelope)",
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/OFPassthroughEnvelope"
              }
            }
          }
        }
      }
    }
  }
} as const;
