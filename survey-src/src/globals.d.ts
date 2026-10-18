// mesfClient.ts 的 createMesfClientFromEnv 讀 process.env（App 用）。網頁版不呼叫它，
// 打包時以 define 換成 {}；這裡只為了讓型別檢查通過。
declare const process: { env: Record<string, string | undefined> };
