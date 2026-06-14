import csv
import json
import re
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader


DOWNLOADS = Path("/Users/almadadgraphics/Downloads")
OUTPUT = Path(__file__).resolve().parents[1] / "migration"
DATE_PATTERN = r"\d{2} [A-Z][a-z]{2} \d{4}"
MANUAL_CASH_CORRECTIONS = {
    ("Cash_in_report.pdf", 31): {
        "description": "Rajab (110000 return to Hsn) total 185000",
        "amount": 185_000,
    },
    ("Cash_out_report.pdf", 17): {
        "description": "2 Tanki Water for Home (4000) Tubewell Bill 4000",
        "amount": 8_000,
    },
}
MANUAL_COLLECTION_CORRECTIONS = {
    1: {
        "description": "CUT PREVIEWS AMOUNT RS 1890895",
        "amount": 288_105,
    }
}


def pdf_lines(filename):
    reader = PdfReader(DOWNLOADS / filename)
    for page_number, page in enumerate(reader.pages, start=1):
        for line in (page.extract_text() or "").splitlines():
            line = " ".join(line.split())
            if line:
                yield page_number, line


def iso_date(value):
    return datetime.strptime(value, "%d %b %Y").date().isoformat()


def number(value):
    return float(value.replace(",", ""))


def write_csv(filename, fieldnames, rows):
    path = OUTPUT / filename
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def write_json(filename, rows):
    path = OUTPUT / filename
    with path.open("w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=True, indent=2)


def parse_cash_report(filename, transaction_type):
    rows = []
    exceptions = []
    pattern = re.compile(
        rf"^(\d+)\s*({DATE_PATTERN})(.*?)(-?[\d,]+(?:\.\d+)?)$"
    )
    for page, line in pdf_lines(filename):
        if line.startswith(("#", "Cash In Report", "Cash Out Report")):
            continue
        match = pattern.match(line)
        if not match:
            if any(char.isdigit() for char in line):
                exceptions.append({"source": filename, "page": page, "line": line})
            continue
        source_row, date_text, description, amount_text = match.groups()
        amount = number(amount_text)
        correction = MANUAL_CASH_CORRECTIONS.get((filename, int(source_row)))
        if correction:
            description = correction["description"]
            amount = correction["amount"]
        if amount > 5_000_000:
            exceptions.append(
                {
                    "source": filename,
                    "page": page,
                    "line": f"SUSPICIOUS AMOUNT: {line}",
                }
            )
            continue
        rows.append(
            {
                "source_file": filename,
                "source_row": int(source_row),
                "transaction_date": iso_date(date_text),
                "transaction_type": transaction_type,
                "amount": amount,
                "description": description.strip(),
            }
        )
    return rows, exceptions


def parse_salesman_collections():
    filename = "Salesman cash collections.pdf"
    rows = []
    exceptions = []
    pattern = re.compile(rf"^(\d+)\s*({DATE_PATTERN})(.*?)([\d,]+)$")
    for page, line in pdf_lines(filename):
        if line.startswith(("#", "Received Amount Details")):
            continue
        match = pattern.match(line)
        if not match:
            if any(char.isdigit() for char in line):
                exceptions.append({"source": filename, "page": page, "line": line})
            continue
        source_row, date_text, description, amount_text = match.groups()
        amount = number(amount_text)
        correction = MANUAL_COLLECTION_CORRECTIONS.get(int(source_row))
        if correction:
            description = correction["description"]
            amount = correction["amount"]
        if amount > 5_000_000:
            exceptions.append(
                {
                    "source": filename,
                    "page": page,
                    "line": f"SUSPICIOUS AMOUNT: {line}",
                }
            )
            continue
        rows.append(
            {
                "source_file": filename,
                "source_row": int(source_row),
                "collection_date": iso_date(date_text),
                "amount": amount,
                "description": description.strip(),
            }
        )
    return rows, exceptions


def parse_trucks():
    filename = "truck Data.pdf"
    rows = []
    products = []
    exceptions = []
    pattern = re.compile(
        rf"^(\d+)\s*({DATE_PATTERN})(.*?)([\d,]{{5,}}(?:\.\d+)?)\s+"
        r"([\d,]{5,}(?:\.\d+)?)\s+([\d,]{4,}(?:\.\d+)?)\D*Details$"
    )
    for page, line in pdf_lines(filename):
        if line.startswith(("#", "Stock Entry Details", "Total")):
            continue
        match = pattern.match(line)
        if not match:
            if "Details" in line:
                exceptions.append({"source": filename, "page": page, "line": line})
            continue
        source_row, date_text, truck_number, purchase, sale, profit = match.groups()
        legacy_key = f"legacy-truck-{int(source_row)}"
        purchase_value = number(purchase)
        sale_value = number(sale)
        rows.append(
            {
                "legacy_key": legacy_key,
                "source_file": filename,
                "source_row": int(source_row),
                "entry_date": iso_date(date_text),
                "truck_number": truck_number.strip(),
                "reported_purchase": purchase_value,
                "reported_sale": sale_value,
                "reported_profit": number(profit),
            }
        )
        products.append(
            {
                "truck_legacy_key": legacy_key,
                "product_name": "Legacy truck total",
                "quantity": 1,
                "purchase_rate": purchase_value,
                "sale_rate": sale_value,
            }
        )
    return rows, products, exceptions


def main():
    OUTPUT.mkdir(exist_ok=True)

    cash_in, cash_in_exceptions = parse_cash_report("Cash_in_report.pdf", "in")
    cash_out, cash_out_exceptions = parse_cash_report("Cash_out_report.pdf", "out")
    collections, collection_exceptions = parse_salesman_collections()
    trucks, products, truck_exceptions = parse_trucks()
    exceptions = (
        cash_in_exceptions
        + cash_out_exceptions
        + collection_exceptions
        + truck_exceptions
    )

    write_csv(
        "cash_book_import.csv",
        [
            "source_file",
            "source_row",
            "transaction_date",
            "transaction_type",
            "amount",
            "description",
        ],
        cash_in + cash_out,
    )
    write_csv(
        "cash_collections_import.csv",
        ["source_file", "source_row", "collection_date", "amount", "description"],
        collections,
    )
    write_csv(
        "trucks_import.csv",
        [
            "legacy_key",
            "source_file",
            "source_row",
            "entry_date",
            "truck_number",
            "reported_purchase",
            "reported_sale",
            "reported_profit",
        ],
        trucks,
    )
    write_csv(
        "truck_products_import.csv",
        [
            "truck_legacy_key",
            "product_name",
            "quantity",
            "purchase_rate",
            "sale_rate",
        ],
        products,
    )
    write_csv("exceptions.csv", ["source", "page", "line"], exceptions)
    write_json(
        "legacy_import.json",
        {
            "cash_book": cash_in + cash_out,
            "cash_collections": collections,
            "trucks": trucks,
            "truck_products": products,
        },
    )

    print(f"cash_in={len(cash_in)} total={sum(row['amount'] for row in cash_in):.2f}")
    print(f"cash_out={len(cash_out)} total={sum(row['amount'] for row in cash_out):.2f}")
    print(
        f"collections={len(collections)} "
        f"total={sum(row['amount'] for row in collections):.2f}"
    )
    print(
        f"trucks={len(trucks)} "
        f"purchase={sum(row['reported_purchase'] for row in trucks):.2f} "
        f"sale={sum(row['reported_sale'] for row in trucks):.2f} "
        f"profit={sum(row['reported_profit'] for row in trucks):.2f}"
    )
    print(f"exceptions={len(exceptions)}")


if __name__ == "__main__":
    main()
