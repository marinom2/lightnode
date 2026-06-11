import { PAGE_TO_CONTENT, CONTENT_TO_PAGE, CONTENT_TO_PAGE_EVENT, type ContentMessage } from "../src/provider/protocol";

// Injected into the page's MAIN world. Exposes a standard EIP-1193 provider and
// announces it via EIP-6963 so dapps can pick "LightNode Wallet" alongside any other wallet.
// We do not overwrite window.ethereum (only set it if nothing else has).
type Handler = (args: unknown) => void;

function createProvider() {
  let nextId = 1;
  const waiting = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Map<string, Set<Handler>>();
  const emit = (event: string, data: unknown) => listeners.get(event)?.forEach((h) => h(data));

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as (ContentMessage | { target: typeof CONTENT_TO_PAGE_EVENT; event: string; data: unknown }) | undefined;
    if (!data) return;
    // Provider events pushed from the wallet (chainChanged / accountsChanged).
    if (data.target === CONTENT_TO_PAGE_EVENT) {
      emit(data.event, data.data);
      return;
    }
    if (data.target !== CONTENT_TO_PAGE) return;
    const pendingReq = waiting.get(data.response.id);
    if (!pendingReq) return;
    waiting.delete(data.response.id);
    if (data.response.error) pendingReq.reject(data.response.error);
    else pendingReq.resolve(data.response.result);
  });

  const provider = {
    isLightNodeWallet: true,
    request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      if (typeof method !== "string") return Promise.reject({ code: -32602, message: "Invalid params" });
      const id = nextId++;
      return new Promise((resolve, reject) => {
        waiting.set(id, {
          resolve: (result) => {
            // Standard EIP-1193: notify the dapp the chain changed after a switch.
            if (method === "wallet_switchEthereumChain") {
              const cid = (Array.isArray(params) ? (params[0] as { chainId?: string })?.chainId : undefined);
              if (cid) emit("chainChanged", cid);
            }
            resolve(result);
          },
          reject,
        });
        window.postMessage({ target: PAGE_TO_CONTENT, request: { id, method, params: Array.isArray(params) ? params : [] } }, window.location.origin);
      });
    },
    on(event: string, handler: Handler) {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(handler);
      return provider;
    },
    removeListener(event: string, handler: Handler) {
      listeners.get(event)?.delete(handler);
      return provider;
    },
  };
  return provider;
}

function announce(provider: ReturnType<typeof createProvider>) {
  const info = {
    uuid: crypto.randomUUID(),
    name: "LightNode Wallet",
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAAAXNSR0IArs4c6QAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAARGVYSWZNTQAqAAAACAABh2kABAAAAAEAAAAaAAAAAAADoAEAAwAAAAEAAQAAoAIABAAAAAEAAABgoAMABAAAAAEAAABgAAAAAKkzX04AACCWSURBVHgB7V0JfFXF1b/7fWv2jUDYEiKLsjTs+y5CEVsKiEq1tsW6VKzW2rrU1C644vZVxQXXzyr5XNAiFMEosotGkCBLWCQJkISQ/a13+f5n3nuY5UFuQPt91je/3HfvnTnnzMw5M2dmzpy54bhYiHEgxoEYB2IciHEgxoEYB2IciHEgxoEYB2IciHEgxoEYB2Ic+L5wgP82Krp0oSkHqxriZF5UHE0OLqB6eI8DOXnCudEzBbxHoukeeWZp4R+Hl+OUdIdJsO4GD28IDtMPehEYVUIagqMphJ/i8bBsHCcoMnwB18mA6CcUHboTABXDwzkc4Wfja9oO5EWpTX7T9KR6GtMK0hoZwjf4c6oi50rzsVn+vgGRn8Rx4kjO5HrxPJ/KG5wqcKEsDJ7jBZMzUSNe5OhuCoLJm0jFLydQHF1CqCAMRgaUBAgeQDIQJT1ETAEMwUmAl3EXDVxIV3EpuJBmqgbHA87kQJxoULwIOiKiZMoVf0QDN3ZRNnikvAAZBsADXhCBm2DWGbzxlWEYnwVEY83HfNnm6at6+QnnXALL9FwIPDTLM1IQlJs0TpgmCbxbRK0MMCSoUT10v2EaxGBWMbobYAnVEczHA92JEVR70wQTecYUYjxiZAAgnSdG4+IEMJXuEvCJ4SQwifAJBjUhIYUvEibPhAPu4ZnFC8AjYZBg0UDwZKIsVI4QB+jGCsvKwZvUGqhsAnqyiEAZggSHKukar2/RzOCj9lH2N/h8NLWzDGctgCVzTLuua3eZhrRIljiHrnOcrvsP6abvA930bBVMo0TihONe06tzaCcQjKkbgVP5iQK1yebBz6mR13C7UimG/tg7pYcgqAdwRJTFhIApTQB9OcgabRiSwJAeIsNQIjQYUX+IHiWEnsKAIZKcileFc3Oi3YznDL6rTbQPVk3bRFW0/UCURJlDnTVOf6NJaLw1YU3CISpVR8MphnQE8bE5DalBw/4M2DqLWkRA8+/2B+sebdRL3n5wzajKjtD6rsHm98tXrsn4xSin7r7ZKbp+KEgCZ3DG3ibZ/7O4fzo2d7Q+HRbA4stqE0Wv63VREKfo0DUBf/2ztdqROx5cM+A/mvFRGCscH11+VbKaep8kyymGbpT7BN/Fzn85P4sCe9qoDglgzpzl4lDtx89BJ16pIcdAsCr/rpWd/gLqrdTJafP7j0s4MPrA6E5qxqt20ZGlmUaRj/dMc69xW26MNOZZDsP0mZdhnvJTGmR9/qoHwPw/A/l7y3xiXPaG7A3lniMLgnqgThKEQXbe/ifLDAWgZQE8+aOGNMNU7xZFnvcHagp3ffGPDmXUkUJ912B7be7z0Qm9Ot9EyxRM4UrP1OBIq3WwLACP4LgCvM8OaEGP319xR0HZzVgixUKEA6+VvLa0UW/azIu8HVPoGzH7taTeLQng+asO2XSdn0/z5aDWsPrP6/p0eLSPFPQ7cLfEk9b1uBkNstaofxpDIxaGwoX1U+pzWsNEe6d1TbvhZENaH2j6CwzNxAqk7vV2Eb5jAAfHHRyTILjmCLx8vs4ZNkWUj/t0z/r93oMFIzePLLdanTL/kfeTpaTjDsGeYefsY4C3vz1cSwLgTfkHWOWqAd1f4fFXbmqP6HclfcWoFe7h4tD7E5Xkq2VBVth0Iqw4XIL7R07RfWPpmMO3Zn3c/Q0rdYKwjtZNqtvBQQCCIeQBZ1l7eJa6G1bmuVhvwFigH9rGrT7eHtEzpV83/u+uq0c95waMJR15JlrnkrY0b6ljtDxqWZot41cyB+aT+cQIeHDVkb2EhIGpZY80e6eXDo88MNtiXqbGGcUEixGghxUcSz0A1pxM0v8wgZR9+GG+ZoVwc5jx3Hhp8vhn5jkcKfNgN+rJm4b42PQ5x7RA3aqq+k+WLd724+rm8P+O5x+6pl+fpCT/hPLSDa2uRj/5SK1xYoUh6F43lzg4Tky8xck7ByqC4khzZjywPm/9prGfjj3WXtkMU2MwsGKFzKvtIFgTgK7beNgrRcGMGJTbIft18q+HvRKXFTflKdWWOl+AOZIMctTtcPW2S+4JTiVh3kMTdv38lsLzd3yN9e0+FQ4sTIiT4xdSH4QZIXBCq7w246PO/2iW6x4wfN3AhIHvuGX3YOoJufHZJKzHm8FEfxRgHupAsKiCQmst0+yw1Y/vljjtb05n2nwDXYgMdkHN+1Uw6N0b1IIBMphKoivPZev68t+Grk3uQLnPCdThdFyg8jamIvy6dzOY/1prgtTa6/UT98H8zCqvGo4JrWGivcOayuBDHIsG0TLOkgCI7Wgs1Gqt0mW55E/cMUiQ464OAJ8ztKZGT8WiyvrtQ0qq3xzq8ZRONzTfPqqeTXJfkBDXe0HLon17b4qhJIs8zMusQuaXyClqvbyivht7AKzXy6KUaKVEGAMYtZAY2sewpIKIDLPpd3DgVNWkKbIo26kwfsOz9M51GY81K9K6xycfvV0QM16HYhIVyXUh0h7FFZUZzfDO+RFqx6vzOvgPa78gdjodwTjemQW7l43SYXi0pn4FSBWtVadB00Kw1AOIJUQOV4eYI/JKOisGsDTDs6VNeYR6WA71BoIReCllYd5Cyw2iDa0ORBz3Hd+D2Q4zmGGQHX940uERrdELx+dLmIpeK/C0OQfbl+77pDVMtPdgqANgILDGKksCoKGT9QDsSEXL9HRxuh4sp3IIwFIFpX9rONFwZ0sG76LdLcyMjj396dPB1jDfxvuMohlfNWpNa4k2phbx6WLGK0cnHv3R6hGrk2Dvdx2ccHDAYOmWF+2Ck+13+DV/bUWwos04Ea1spG1pbLM6EltqcdSrKLD9wtCjpV9PoHytTUppEkXVqYjuXz007cgnt6zuuhLI+pIJxf1UJfGv0MUSCUAyDMsmXEuZnwGoaGTRDLfgHgt1jSUOZ9oEtWealPbGOPe4Q6PiRvlUztZV5iUXkYBNhzvWVHFf/83995yB5KkkA7yifT/NmimIhiELASMl7d2yBYoF8AjInwuH7QwGa5bR3ix2ZVNsUqflT8xoKHx6et178Y6eH8FuNdQkJuCKE51X/M+k0j8B0FKZXnpmeY9dn+++Z9/u/Q+vf2/9OJaFhZ+isTsvz3X2ftUu27sAnPjL8sMGE28TbD1doquvLID5YKLfCGjlnvJ7f7b5ygctkGYgtJsZwOUXrA3DlnoACnm2wSytW3dnV3NyqtOWfqkkSqrIucZQi2eb8eivohlExWVslktqgtr5j2unlKVvOLrit/nF15/WBeTFF1/sPHnimH926pLRlwqW3ilt4aoVqxZcNOuiN89U0P2T9l+XpWQtwb6wisYE1vNCtae6sNaoXZ2ipMxWeKUnbb5rhtbg1bxF5b6KpwZs7rf6TDRbpwXRmpgQLPLMkgB4zEOpmURcTFpneqb3x7deUd+Pm3PlgvH3fxjnSFpgcmov0FEMM1gZ0JreMn01292Org+7RXsX8lPIUDpfMzNzbuZQV95107cOL4tGe/CAwT8k5psINHrEJcQ5+p7fdxFg38ZFarhFKBxfaMux5/4uXUy9WzZlAZvpcKvg+YqmyrffK/9o4dUlc6vmcHMeuXXsDemaIKu1dWV104vmVrUgYvElCC6RAOiyEiwJgDxLqBegV55VKOYKAr//sGApkJfekvduiltyYWpXXp8P4RDB/x6985DL0eOVJNnVGyqJ62pLmSkbPlrSX7Nmyke9MhPTeu/VDhXNfnM6E4gpiKQ+wh0z5FpidzoSOK6LynFl3ry8PHnJ3Y+NUSTFP2L6kI2uOFefBCn+Dsb8IDGf46sD1a+sP/HRtWA+62kFKGPB+oJSonsugdQPzSQ0i9yyJADy4aEeIJJr1VmEv48vdHVx9fy5qSs1PtPrdeui7UC9d0WE1OUb+n+6fMSmmW53v5c7q3HDa3wNu8qbyhZ/MXX3vB7x3R6F11p6mpny5fLJy6fNXTv3CMoStRwkFUhI+Mey5fd3ycq8CZzQ9mzf90jvwbl/2Dez5Maujqy/K5wiHms4/vgzx5ZCzeUTv77RoGHe6kfpAjAbWCFsSQDkUUbUTEO3RLR1xnUeXT3Plvo7u2TPJKVhGN7GODGezNqsBxD83M0jS14dtuUS0ZV1e0l1yX9dkJYxvJuz2wuqBH0NnFR3Sp/uad3Jxv7fIMDKgbqic0YqKphlXJl+7233upOTkuba7ehkAiflZvf67b7tJXLu4JybSuaWuG2mLHdZ2+0+0Gmjqqgc5xp0NFKSaoC8ziwESwIgOlRjNl2wQLQ1SJqomTLGJh6TY0bH5P0qzI6t4S7bOrwCcYu2j9s+oZva7RlVpMES7Meg4Q/6fX5DLyEcrGQZKtQVzwusovhh5PiDaw96PFc17UvqlJBp+llP4Xv26LFo54bikzmjc+5hiN/ij980eFJBfmv8t8ZTCVIl5XNWzT9cWbgQMvdCch2ETxx+fVHZsDrvjU45tpynVEGleTiN/ryma8HK+spbxrw2YitDosl2OETqicUi14XrItBibvfn+35fe7y+Ar6J5PFoQnVyvbKz79q8avOPI3jt3ZfPeT9+ad720Ay6PeBm6QEUja0DmPGmWcJpHr+uyWkAKJpUDwFaAo5Cx96IHgDdQy6F5EArg/8KvEajgHIXxA//Q7wSn4u00Lobmdb6axd3/UfXJyLwp/hPFMJUsKDjsrpkMZAL50/cWrzjiwWeJl89egjZJw2bQ5Wyc3rd9+QDT6ZF6ES7/2bEEvuLk8tv4JqGLLclOOOiwZwpjqkgtFTfN7kpTz2e9YCz1ZrxxHTeJG9Q0nkKm1O1rcbHQz/OTZATrggpDqTDXlkbrF3/8pGX720ODSfdUABnI1LEWGCWln09iRk9Y/T75WXlD7Kui85rYuqZmpacM3zIyCub04o853P5wtPjD0wenPCLNQ575uNe096nyUaWnY4FUj+RmZAVTEuNWkIjIkBMnSP1tUL7FIxXl8irmXkrUy8g93AMkW1CJ2fneQ7FkUiKAxcPi6VeZVQ9cPPmli4wQsQ2QuNv2D4FNcOPGDGiBc01q1c/UVtdfwiZk4ZiOjQ9Lf2yhQsXtt2tGtk/RbQlvcRJ7tGNYHuQ54I+rbHDWjdAYwCwtG/SGkr8IJMgVtcdLlCEI6RMI+7jzLwYSQjfsRASsT6Yyl7Jjxxzda/u27ulfkthK1BMgsINEzdaN1A30NBYN2/e3AL0httvqK6prVnNuh2VHON0nCuuz0VDLu7TAhAvDkUVdF4SvcT8EGhrEEvvVByNBGBxxm6pB2AhzFYA0RhnqVQACrX8kAqCMNr0pIvzLk6z87ZepO5YQMn8XKDop2t+irMvrQINAphREUNh1g9NgNpQDOE0eBo3GYFQIn5NTE/V9IzUfq0osldkzeRJRQBZsBG6s4PBBKeoaFYXYpYEIIIrzH7D+nEHSxQGJ93PegHudErFEFoOwn0TeqXCNSS+eRbg7PGouWnwfgLzzdCSMyQM1BjrgDZi8Nd7qoI+ABJXMaWlfemUpNTQaN2CuAObKGB8+AqtNOpaQFh5wQworIKsQFuc2OCgBRsDSDOcTYjDeotOtZAASBBilDEg6OMcooltwkgPAJxh6FEbyJGvjhUF6nEmh0YKMr4g1NU07MetrQkGguJ0QKJZMoFhhMR+MDsyRnjNA9UuJKfQ3afRErRjgbUJYFEvsBKiVrA1IpWC2ezZtkzrVGvvIXwIALWMpsqg1/06ztAwasQJJms+SkvluOf/Z+l7O3fsfKTuZH2tv8nvKd9fsXl38Y47IljNS2RoYpasi7wBT1a6OCg0w2+2adq030itnq5I9gFJZ6VoTq+9Z9oTZjInplkIlgSAMyBsXw7AFsm2zZlafuSK1q4qtcoTGq81MEyqNpqQwqk/eOKCJxJbUysoKAgMmZL3m7dXrhr8wfqPh//mmvsmzVowa29rOHpP5JPGCZjMGPXQ7/VYgteYXGV5TVTVhlltiPkkCIwByln0AMZ85Gu1BxBP2g1wNg2PAe2CnhaAJE2ZMd5i+t56DFhXs65yrHtsORRKSlgPmC7V1XNUj1EXc19wL0YjfNWNlx6IFh+JezN/ZW6KnnahD+xmRzBhOPU2eQOVhyvIE6JNoNZP26c0OlFXDLWGNmBnjsBhOBICCfDMgKFUSz2ATUEBH011WMkEkz9S1PDcDqkgLE15jtRBs/B4yeP+umBDaB5JUkINJEPkutizbnty5JlXr83INH+U+tr73+fyOFP9FZwRrETvPYmxoty7f9WOj3c3B4w8n9L/KCcNL2cTGA2Gam3NZEkAtCVPOhx2lbMrFVBJeIRM6xNqZdFCeeDYm34NXkTkMUJngmG7T+IT+8zofPHS/Ise64hZQPzs1v1/zuAzL2mq4kwNh7YhAC4AU19lWdVbTxTkR91toyyJgSH5Ryth+3EGmn9EkO1DW5wF0bSRJAUhUNnOIpDVOYzKpIBXe1syf936p/VV/uoNYQ7Q/N7EvMbMkjIv+VXCvLfWXFw4uC1Wy5g3rl7bs3jR0ReybD1/H2gUuABafaAGOrmG44+X11ds37NzGTDaNAF4frMmGxmEWYVbkrb0hk7LlM8pe1U7WJbGADIqnm720g79cHIcHYwOVRtyoNpHM0Ws4lb5DzQdzE8Rk1baJNWOkQznvAEMwac70iYOd7oKS+cfXdEoBd6sNquKD3FH6usxd+omd3KkuVNznYZ7epySMMclOTJ8DRhnsIQndDRKdGKDO3ji8OJfF8w99PblFff7cah53muZf2TU8UOzIHLZZioBBWS7nWcxCpD7JTGf2o6VYEkAPLYkSQWBbpuWYyUTpjsi5SE5RJnOlkwqmebx+fn+G/ut2jVs94N93X3uYnN8LD5odgK/NMMlO1xu1XG5VzAvhy9PQy+hT0PQgQYn8A6RlxNtODsdxPTD04AlBHBoMISPDg/TEX+4vuz1Ga8NePzVuYfmq0LyzXT0/dWfVLne+vLvtxVgZ0wzYDblDJUqSG4aAm+oqp7Q8friuwmsqhYxLQmAPhlAgIphbWBpLZSvAlt8Yx1jqTFS7ah5cfu8R05tB3415qufgKHPaw7dv2vk3ovO33Te3fuHH87IdnX7JbhI5mQ6/8Yz/YpxwUSBsFPmlgXVTUs1Uhtkt0QrJjiaAtLeD4dZPDl1c6XeY/9aU7Hy2qdmfdbbKaU/5jdEESsOU5ZSbpqSc0Nyj4RB1x8yamuSAkeuE/ziMTjsmjgVn4J5UNSxgqpx2kCGQsZ8axIAdPsBtly2DkCPtka1GUkchIif6V54oyLIGWA+Yz9MDkmz02c/UjyseHTpmNLZGbaM51VecTkle3JXZ+dXtg35vO8lW2bc8GVjyRIvPjdBtigNHA1incsuL2cGmjjT34h7I2eQugmih+Di/LgCSNd8HO/zQe1Ul760at/b8+/dcF2NYog2n2Z6Auga+ICC6YH/oKImL+iUOPKlfo5uWU5bktfpShuf5Ow8XrG5jCqPHnXF3Kx6UR9ZJaOmtI202ANgJABuR7lfPKq4X2db52fjpfjhjPVEAJdoSHKinHipM855CUwnBgQCRQJ9j9mPW3TmdnIkTyzmiov7bel1y4Yhn27Ndvb8Y5yY0I+GEbR0nhgIOgCP6Fu0eiKEi3aOSO3U6nUlx/xH75v9Qd9lBIaLu/rdAZ/lT/1kRmdH7kuKEjfIhzyDsB0IcsolTsE5ThLtiTCGsAWLBIzunRL3/G3GwdtuX9nzHcLvWGCKqF0Uiz0AYwBIwUJsjSpgtw3ZltFN7fZ6vAzmg3G6qQUagg1f1PpqP/Xr/loSCByhbDIvOzBSEl0Bth+uorHqLxWNFU9FSj76k7zlbx18b8yexgPXHPFVfVQX9NQEMNKB+2Qlx648J0Cd8H5N5xuCnvrjvhMbDzccuHFN+TujwPxnQYcxP0Ivf82QXYdPfj6rzndyIxIEUl0QmMELdtqH4ILQW0FIlgokSs7eitLllTun7pkYwbdyJ9wWmZ4ByVoPQMloEKbpqNXQ3dn9Jqfs7Eco2FDfU6kdXbSq5KUNTx99N/jckCdzuzt63R2vJsxBOhHlYQcKnAycvDtjQ9q9rfO47sjlNdwR7mnEP/va+et6ZNjT+4qSoyu6UgLpe8zRTno4b2m179i+BdsnHgAcDQGnDX9dP6500bAVszOTRzwrK8kzaMil3uXz16zWjIbnfJomO9XEKxUl8UJBlN12Oe2eq7o/v+mFwz+LvpHdLCcag9i3cixuXlkSAL7FE7aGopQWQuHAtxJcgottgGumVn/Mf+xnPTb23BJBHfjJ0OLCfsuvHpoxI8chOQbRoFzpq7wnc31mG+ZHcMJ349Jdk4jBdJ1TeHTrrIpFY9bfkZk0dJKMKW8g0LBtd+k/f/LyztD+Aw4S/jM3ZW6hzLvyBMWVl5EzqA93mCtqL9NIy//aXebMGJZUEJEgQMwILUkgSerZReLFzFCXDu7osbHHKeZHijOheG4jWv0agoHq5k4ET+yLpP277onOTkmYJqk0bvi0hq0R5lP+yzb+vCFo+LZRz0DNbZLotnSEiiZBIS5ZYhWzj1EOZwwClncWd9jCdAJfKyuaVJ8uhHfXSQdl2DJv2z++dB50B7KiRTDOlCEeExVeQ6XYM7wzyD8jCF+giNk35AIC3c1gRDhFYclF6ag/6SFameJ8Ggzd9F0fnSZUMMnxUtB/8gW/UbvfjqPnhikpiuxqvU0pyKJ6HhUeCxFs9QZr8WgtoELW2B8yULZLFLqfuaVYHYT3modKs7l+5fCCyJUledCBUQcGZ2/M3t48o/fz3o+XeNs0khT9pcrJeak8l0cbGrSIojstFIgBxHxiNMUTY324KJ2eaQeG0mgjnJ5JEMR4eqcrJETcEU/rBaJHa4Mm0y4uXTll7g0z1+3D+YXzcVhwwuKZVQ82+KtewIIOxU6+WhRd45AlfXltT03w2B48WgjIqAPBErSIkhMgdhFRhfbD3E/n1tVr9SupGUiCFJeupj93BJ8DwBEk2hQTvhz9Ze6QuGHL7II6AOqfjHOMrgbu0BYInTChOzEv8k5x7AIMwUXeGYPDsMRchhfBx52ZlsN33Gi44TQgCYJz8rwRS7IDgerFJu3iQhfhu0u3xLtytqj2bpsUOfEGTLJEnPLhGj3lS574cIL1RRlqQ3lZCZYGYVIKJADQZYyyQnh/9d6HXamOmW7VnYPZUH9FzPrXkuSHdz40dYlfNqW+8HxLoVIGDU2vDtYU6bxJVgSBnJep8JiZsM1tqCLoDLR6+INitsrrUC/UM/BpOLgAYqcR79Tygc+T+qGNygCeWU8i1UMqiaXjB4Fok1rDmWdZle1T8/+V/dCd0w51c6kZd0mSzc7zspNgqKKG7vPVN5Xdu3jdeS/j1WKg3BAsztgtCQCfKWCzIKyULPUYyn/crnGlnw/+/PKefPYrbsXVC6dO7Dj2M4zSmB5ALQNGUK8OnMzPXD/pfo4rpsYcCVR/4gOFyDPdv8nA9+uXz2j+ZXWPxbdO+GS9U828TJGdvdEE+IDm21vvOfLqwx8N+7gjmaKHhcoZKX07yBYFINQTVWzORzEinz6HgdsHbts4aOOUHHfuH2ChnAXbTQoahgRB+pp0b1GV98T9523LoUMV/yehuDj/VL4PFA7ZiBe6zilg71AhEZxp7tE8A0sCEA3zKC2FFU7MIAcqHGZo3lqb02vzPKpo1FeI/NWaQWvuSZfTs92S247DEVX3b7+/mA5FtEH4jkcEDTPThjpg7MEuRPvBkgAEwdhHA59oyj1/OegP6QVFBUfbJ90SYmrRVMLpMF5LKv/v3+AFKbDVP9auJVZKa0mni5JWhImwxy4oGUm2tFFWCH8fYe6Yvrsrx6sDyJaEk/Utpt2n44clAVSd2LsPlrLPHDCZJMjuK0AsNNCcjur3NB4OHbOweEvByq7C0Bo3WWGDJQEM/nRwEIuxl2nubROdF+4YUzbRCvHvE8z1k9Ymq6LrWua4LRjv5a9KLrNSf0sCIEIOWX4daminE7aTJD7hgcK87dgxioUIB1LV/ncpir03zNkNONb7X5H49u6WBZC0lq+D2+nvA4bpj5ecg3KcOU+9m/duWz/79nL8D0z/44wT16pK8vVUNdibHr3jTeUzq9W0LAAimPWBbRWcbP9KS6QEOX72oLjRL0AI3+eewN85/ditNiXhYQk2F83U36ttrG7PpN5CNh0eTHHqXOrPjXoQnxdYRJ5u9cG6T476y24buPX8whaU/8Nffjdtx3kOIetuVU2YL2LDRNP0D7C+vOyOd1xw/7IeOiwAIm3OMcXaSu12WRDvdAq80qgH/F6j8R2P3vD8fvv+TVPWTmnjfWy9SP9/Ia8bv9yVaBswUFFSL5UFxxzMeNJCRkPj1WCwaVH+u3HwwetYOCsBRLKom+CbjuP/f7Hjo9U0MQ1gTzfAB/fBRLbTH/SU4qtglfBpJLsYjHkwrgkwq5K9mP7niCCdOmoUhP0EKVBs+OIdU4oijHT4vw+wG5NpC0a60J32gDEdw4EXngxwLA0rdEy7mQMWZRRAHtjbhxEudF6XnKTo1IoONy24I5n4jAwzzsFOBxyY93CIleLxxngROoNMhaC8QUkQHHCdxyfOlE6wmPbleeU8uyzBnAKDoGYeQenuLZLffrqgYK5l6wCInwrnJACicnLyyXjVcM2HhfNKEPuBhJKyVQIKyEIkh8g73Skucg8/UumJgXTRM7P1Ay6yB0C2fVZp3Mn+TydZSDCn7P70jovhh59PnXYJ0yQWk9DoIgsrFYFd4Xi8svdTd8SzZwDRhgjh+QPw0eHMnRDj67oRfPXOFY7SENTZ/YazODvk5ljFc0yl+0nPADTR4ThT2UcyhS5ohW7mk4htKLIqs90E7Clgm4+1RDI8Iw7PdNQrxFD0AOaERWZnHyx3iKddLGI2zNMwN6PEfmIG7uSzRQejSRBkjg7RgH8b0aQ4wNPuGO4kMLa7SDj0jM5GXYCVAK/4aA55/1G0CIMmue4Z6Ky0e8Dsyl70glL8J5ldGuf/FB/Q+jz/3UzyZjzn8I0J4DQlYaWnNMqIWlskw8gz3duGSGokpfX7OcYzvhKNSKmaP/8pUkRE5rM2g4foxSS0WIhxIMaBGAdiHIhxIMaBGAdiHIhxIMaBGAdiHIhxIMaBGAdiHIhxwCIH/he+5iHu93urIgAAAABJRU5ErkJggg==",
    rdns: "app.lightnode",
  };
  const emit = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", emit);
  emit();
}

export default defineUnlistedScript(() => {
  const provider = createProvider();
  announce(provider);
  // Legacy fallback only - never clobber an existing injected provider.
  if (!(window as unknown as { ethereum?: unknown }).ethereum) {
    (window as unknown as { ethereum: unknown }).ethereum = provider;
  }
});
