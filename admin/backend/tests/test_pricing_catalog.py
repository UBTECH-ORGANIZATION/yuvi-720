"""Tests for the effective-dated production pricing catalog."""

from datetime import datetime
import unittest

from backend.pricing_catalog import pricing_documents


class PricingCatalogTests(unittest.TestCase):
    def test_deployed_models_have_explicit_global_standard_rates(self) -> None:
        documents = {
            document["deployment"]: document for document in pricing_documents()
            if document["provider"] == "azure_openai"
        }

        self.assertEqual(set(documents), {"gpt-5.4", "gpt-5.4-mini", "gpt-5-mini"})
        self.assertEqual(documents["gpt-5.4"]["input_usd_per_unit"], 2.50)
        self.assertEqual(documents["gpt-5.4-mini"]["output_usd_per_unit"], 4.50)
        self.assertEqual(documents["gpt-5-mini"]["cached_input_usd_per_unit"], 0.03)
        for document in documents.values():
            self.assertEqual(document["price_scope"], "Global Standard")

    def test_copilot_models_are_priced_for_the_game_worker(self) -> None:
        documents = {
            document["deployment"]: document for document in pricing_documents()
            if document["provider"] == "github_copilot"
        }

        self.assertEqual(set(documents), {"claude-opus-5", "gpt-5.4-mini"})
        self.assertEqual(documents["claude-opus-5"]["input_usd_per_unit"], 5.00)
        self.assertEqual(documents["claude-opus-5"]["cached_input_usd_per_unit"], 0.50)
        self.assertEqual(documents["claude-opus-5"]["output_usd_per_unit"], 25.00)
        self.assertEqual(documents["gpt-5.4-mini"]["cached_input_usd_per_unit"], 0.075)
        for document in documents.values():
            self.assertEqual(
                document["price_scope"],
                "GitHub Copilot usage-based (AI credits at provider list price)",
            )
            self.assertEqual(document["effective_from"], datetime(2026, 9, 8, tzinfo=document["effective_from"].tzinfo))

    def test_every_document_is_a_complete_token_rate(self) -> None:
        documents = pricing_documents()
        self.assertEqual(len({document["pricing_id"] for document in documents}), len(documents))
        for document in documents:
            self.assertEqual(document["unit_size"], 1_000_000)
            self.assertEqual(document["currency"], "USD")
            self.assertEqual(document["meter"], "tokens")
            self.assertIsInstance(document["effective_from"], datetime)
            self.assertIsNone(document["effective_to"])


if __name__ == "__main__":
    unittest.main()
