import { describe, it, expect } from "vitest";
import {
  detectFormat, parseCsv, parseXml, parseJson, detectObject, buildMappings,
  toMoney, toIsoDate, buildPlan, parseSalesforceExport, TARGET_TYPE,
} from "../services/salesforce-importer";

/**
 * The Salesforce importer moves money and dates into the period engine, so its failure modes are
 * not "the import looked wrong" — they are "last year's revenue is now in this quarter" and
 * "every won/lost ratio shifted". These guard the coercions and stamps that decide that.
 */

describe("format detection and parsing", () => {
  it("reads RFC 4180 CSV — quoted commas and embedded newlines", () => {
    // "Acme, Inc." and multi-line descriptions are the norm in Salesforce exports, and splitting
    // on commas shifts every later column on exactly the rows a customer cares most about.
    const csv = 'Name,Amount,Description\n"Acme, Inc.",1000,"line one\nline two"\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Name).toBe("Acme, Inc.");
    expect(rows[0]!.Description).toBe("line one\nline two");
  });

  it("handles escaped quotes and ignores trailing blank lines", () => {
    const rows = parseCsv('Name\n"He said ""hi"""\n\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Name).toBe('He said "hi"');
  });

  it("unwraps the Salesforce REST { records: [...] } envelope", () => {
    expect(parseJson('{"records":[{"Name":"A"},{"Name":"B"}]}')).toHaveLength(2);
    expect(parseJson('[{"Name":"A"}]')).toHaveLength(1);
  });

  it("REFUSES XML that declares a DTD or entities", () => {
    // An XML parser that resolves entities is an XXE and an SSRF; a flat export needs neither.
    expect(() => parseXml('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><records><Name>&x;</Name></records>'))
      .toThrow(/DTD or entities/);
  });

  it("reads plain XML records including CDATA", () => {
    const rows = parseXml("<records><Name><![CDATA[Acme & Co]]></Name><Amount>50</Amount></records>");
    expect(rows[0]).toEqual({ Name: "Acme & Co", Amount: "50" });
  });

  it("keeps CDATA text whole when it contains what looks like the closing tag", () => {
    // Measured against the real parser: this returned `"<![CDATA[quarterly"` — the field regex
    // stopped at the `</Description>` INSIDE the CDATA, which is the one thing CDATA exists to
    // prevent. Description and Notes routinely carry markup, so real text was silently truncated
    // and literal `<![CDATA[` was imported as data.
    const rows = parseXml(
      "<records><Name>X</Name><Description><![CDATA[quarterly </Description> review]]></Description><Amount>100</Amount></records>",
    );
    expect(rows[0]).toEqual({ Name: "X", Description: "quarterly </Description> review", Amount: "100" });
  });

  it("does not import a nested sub-object as markup in a field", () => {
    // Salesforce nests the related Owner/Account. This used to yield Owner: "<Name>Jane</Name>" —
    // markup stored as data, unreadable by every downstream surface. Omitted instead, so the record
    // is honestly missing the field rather than carrying nonsense.
    const rows = parseXml("<records><Name>V</Name><Owner><Name>Jane</Name></Owner><Amount>7</Amount></records>");
    expect(rows[0]).toEqual({ Name: "V", Amount: "7" });
  });

  it("does not mistake a bare number in prose for a CDATA placeholder", () => {
    // The placeholder is NUL-wrapped precisely so it cannot collide with ordinary text; a plainer
    // marker would let "we sold 3 units" absorb an unrelated CDATA block.
    const rows = parseXml(
      "<records><Name><![CDATA[first]]></Name><Note>we sold 3 units</Note><Other><![CDATA[second]]></Other></records>",
    );
    expect(rows[0]).toEqual({ Name: "first", Note: "we sold 3 units", Other: "second" });
  });

  it("reads a real Salesforce SOAP export, stripping namespace prefixes", () => {
    const rows = parseXml(`<soapenv:Envelope xmlns:sf="urn:sobject.partner.soap.sforce.com">
      <soapenv:Body><queryResponse><result>
        <records xsi:type="sf:sObject"><sf:Name>Acme renewal</sf:Name><sf:Amount>50000.0</sf:Amount>
          <sf:CloseDate>2024-03-31</sf:CloseDate><sf:StageName>Closed Won</sf:StageName></records>
        <records xsi:type="sf:sObject"><sf:Name>Globex</sf:Name><sf:Amount>1200.5</sf:Amount>
          <sf:CloseDate>2024-06-30</sf:CloseDate><sf:StageName>Negotiation</sf:StageName></records>
      </result></queryResponse></soapenv:Body></soapenv:Envelope>`);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Name: "Acme renewal", Amount: "50000.0", StageName: "Closed Won" });
    expect(rows[1]).toMatchObject({ Name: "Globex", CloseDate: "2024-06-30" });
  });

  it("ignores a field hidden inside an XML comment", () => {
    const rows = parseXml("<records><Name>W</Name><!-- <Amount>999</Amount> --><Amount>5</Amount></records>");
    expect(rows[0]).toEqual({ Name: "W", Amount: "5" });
  });

  it("detects the format from the payload", () => {
    expect(detectFormat("  {\"a\":1}")).toBe("json");
    expect(detectFormat("<records/>")).toBe("xml");
    expect(detectFormat("Name,Amount")).toBe("csv");
  });
});

describe("object detection", () => {
  it("identifies the object from its signature columns", () => {
    expect(detectObject(["Name", "StageName", "CloseDate", "Amount"])).toBe("Opportunity");
    expect(detectObject(["Name", "BillingCity", "Industry", "AnnualRevenue"])).toBe("Account");
    expect(detectObject(["FirstName", "LastName", "LeadSource", "IsConverted", "Company"])).toBe("Lead");
  });

  it("maps opportunities to the type production actually stores", () => {
    // "deals", plural — measured against live records. A singular guess imports rows no list reads.
    expect(TARGET_TYPE.Opportunity).toBe("deals");
  });
});

describe("money coercion", () => {
  it("reads the shapes Salesforce exports", () => {
    expect(toMoney(1234.56)).toBe(1234.56);
    expect(toMoney("1,234.56")).toBe(1234.56);
    expect(toMoney("$1,234.56")).toBe(1234.56);
    expect(toMoney("(500)")).toBe(-500);          // accounting negative
  });

  it("reads European separators by position, not by guessing", () => {
    // The LAST separator is the decimal one — "1.234,56" is 1234.56, not 1.23456.
    expect(toMoney("1.234,56")).toBe(1234.56);
    expect(toMoney("1,234.56")).toBe(1234.56);
  });

  it("returns null rather than zero for unreadable amounts", () => {
    // Zero is a real number a deal can have; using it as "unknown" makes a broken import look
    // like a pipeline full of worthless deals.
    expect(toMoney("n/a")).toBeNull();
    expect(toMoney("")).toBeNull();
  });
});

describe("date coercion — THE rule", () => {
  it("NEVER falls back to now()", () => {
    // A close date that silently becomes today books a deal won in 2023 as this month's revenue,
    // moving the period figures, the forecast and every won/lost ratio — plausibly and invisibly.
    expect(toIsoDate("not a date")).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it("anchors date-only values at midday UTC", () => {
    // Salesforce CloseDate is YYYY-MM-DD. Parsed at midnight, a negative timezone offset rolls it
    // into the previous day — and for the 1st of a month, into the previous QUARTER.
    const iso = toIsoDate("2024-03-31");
    expect(iso).toBe("2024-03-31T12:00:00.000Z");
    expect(new Date(iso!).getUTCDate()).toBe(31);
  });
});

describe("field mapping", () => {
  const mapped = (cols: string[]) => Object.fromEntries(buildMappings(cols).map(m => [m.source, m]));

  it("maps money to the field the product actually reads", () => {
    // The brief said `amount_presentment`. That field does not exist — dealValueOf resolves
    // deal_value/value/amount/arr, so an invented name imports records no money surface can see.
    expect(mapped(["Amount"]).Amount!.target).toBe("deal_value");
    expect(mapped(["CurrencyIsoCode"]).CurrencyIsoCode!.target).toBe("currency");
  });

  it("maps CloseDate to closed_at, never to updated_at", () => {
    expect(mapped(["CloseDate"]).CloseDate!.target).toBe("closed_at");
    expect(buildMappings(["CloseDate"]).some(m => m.target === "updated_at")).toBe(false);
  });

  it("carries custom __c fields across, flagged as inferred", () => {
    // A customer's Renewal_Risk__c is often the column they migrated FOR; dropping it silently
    // loses the point of the migration. Flagged so the matrix shows it as a guess.
    const m = mapped(["Renewal_Risk__c", "Contract_Value__c"]);
    expect(m.Renewal_Risk__c!.target).toBe("renewal_risk");
    expect(m.Renewal_Risk__c!.inferred).toBe(true);
    expect(m.Contract_Value__c!.kind).toBe("money");   // inferred from the name
  });

  it("reports Salesforce plumbing as unmapped rather than importing it", () => {
    const r = parseSalesforceExport("Id,IsDeleted,Name\n001,false,Acme\n");
    expect(r.unmapped).toContain("Id");
    expect(r.unmapped).toContain("IsDeleted");
  });
});

describe("the plan", () => {
  const OPP = ["Name", "StageName", "Amount", "CloseDate", "CurrencyIsoCode"];
  const plan = (rows: Record<string, unknown>[]) => buildPlan("Opportunity", rows, buildMappings(OPP));

  it("stamps won_at from CloseDate, NOT from the clock", () => {
    // withStageStamps only fills won_at when absent, so setting it here is what stops an import of
    // historical deals stamping every one with today's date.
    const p = plan([{ Name: "Old win", StageName: "Closed Won", Amount: "10,000", CloseDate: "2023-06-15", CurrencyIsoCode: "EUR" }]);
    const d = p.records[0]!.data;
    expect(d.won_at).toBe("2023-06-15T12:00:00.000Z");
    expect(d.closed_at).toBe("2023-06-15T12:00:00.000Z");
    expect(new Date(d.won_at as string).getUTCFullYear()).toBe(2023);
    expect(d.lost_at).toBeUndefined();
  });

  it("stamps lost_at for a lost stage, and never both", () => {
    const d = plan([{ Name: "Gone", StageName: "Closed Lost", CloseDate: "2024-01-10" }]).records[0]!.data;
    expect(d.lost_at).toBe("2024-01-10T12:00:00.000Z");
    expect(d.won_at).toBeUndefined();
  });

  it("writes BOTH stage keys so they can never diverge", () => {
    // Production had 28 of 44 deals whose two stage fields disagreed; an importer that writes one
    // of them is how that happens again.
    const d = plan([{ Name: "A", StageName: "Negotiation" }]).records[0]!.data;
    expect(d.stage).toBe("Negotiation");
    expect(d.deal_stage).toBe("Negotiation");
  });

  it("warns instead of dating a closed deal that has no CloseDate", () => {
    const p = plan([{ Name: "Undated", StageName: "Closed Won" }]);
    expect(p.records[0]!.data.won_at).toBeUndefined();
    expect(p.issues.some(i => /no CloseDate/i.test(i.message))).toBe(true);
  });

  it("rejects a nameless row instead of importing a blank record", () => {
    const p = plan([{ StageName: "Lead", Amount: "5" }]);
    expect(p.rejected).toBe(1);
    expect(p.ready).toBe(0);
    expect(p.issues.some(i => i.severity === "error")).toBe(true);
  });

  it("composes a name from first/last when Name is absent", () => {
    const p = buildPlan("Contact", [{ FirstName: "Ada", LastName: "Lovelace" }], buildMappings(["FirstName", "LastName"]));
    expect(p.records[0]!.data.name).toBe("Ada Lovelace");
  });

  it("collects the currencies present so mixed-currency imports are visible", () => {
    const p = plan([
      { Name: "A", CurrencyIsoCode: "EUR", Amount: "1" },
      { Name: "B", CurrencyIsoCode: "usd", Amount: "2" },
    ]);
    expect(p.currencies).toEqual(["EUR", "USD"]);
  });

  it("honours an admin override from the mapping matrix", () => {
    const p = buildPlan("Opportunity", [{ Name: "A", Weird_Col__c: "keep me" }],
      buildMappings(["Name", "Weird_Col__c"]), { Weird_Col__c: "renewal_note" });
    expect(p.records[0]!.data.renewal_note).toBe("keep me");
  });

  it("lets an override DROP a column", () => {
    const p = buildPlan("Opportunity", [{ Name: "A", Amount: "999" }],
      buildMappings(["Name", "Amount"]), { Amount: null });
    expect(p.records[0]!.data.deal_value).toBeUndefined();
  });

  it("tags every record with its source system", () => {
    expect(plan([{ Name: "A" }]).records[0]!.data.source_system).toBe("salesforce");
  });
});
