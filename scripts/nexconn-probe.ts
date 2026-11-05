// throwaway: check webhook signature header shape
const headers = new Headers({ "x-nexconn-signature": "t=0,v1=abc" });
console.log(headers.get("x-nexconn-signature"));
