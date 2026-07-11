"""Tests for the effective-dated production pricing catalog."""

from datetime import datetime
import unittest

from backend.pricing_catalog import pricing_documents


class PricingCatalogTests(unittest.TestCase):
    def test_deployed_models_have_explicit_global_standard_rates(self) -> None:
        documents = {document["deployment"]: document for document in pricing_documents()}

        self.assertEqual(set(documents), {"gpt-5.4", "gpt-5.4-mini", "gpt-5-mini"})
        self.assertEqual(documents["gpt-5.4"]["input_usd_per_unit"], 2.50)
        self.assertEqual(documents["gpt-5.4-mini"]["output_usd_per_unit"], 4.50)
        self.assertEqual(documents["gpt-5-mini"]["cached_input_usd_per_unit"], 0.03)
        for document in documents.values():
            self.assertEqual(document["unit_size"], 1_000_000)
            self.assertEqual(document["currency"], "USD")
            self.assertEqual(document["price_scope"], "Global Standard")
            self.assertIsInstance(document["effective_from"], datetime)
            self.assertIsNone(document["effective_to"])


if __name__ == "__main__":
    unittest.main()