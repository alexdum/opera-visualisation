import json
import urllib.request
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

req = urllib.request.Request("https://observations.meteogate.eu/collections")
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        data = json.loads(response.read().decode())
        collections = data.get("collections", [])
        for c in collections:
            print("Collection ID:", c.get("id"))
            print("Collection Title:", c.get("title"))
            
        print("\n---")
        if collections:
            c = collections[0]
            print("Parameters for", c.get("id"), ":")
            params = c.get("extent", {}).get("custom", [])
            for p in params:
                if p.get("id") == "standard_name":
                    print("Standard Names:", p.get("values"))
except Exception as e:
    print("Error:", e)
