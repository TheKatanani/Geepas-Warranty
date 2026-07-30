import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const targetUrl = process.env.WEBSITE_URL 
    ? new URL("/pages/contact-us", process.env.WEBSITE_URL).toString()
    : "https://www.geepas.com.iq/pages/contact-us";
  return redirect(targetUrl);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const targetUrl = process.env.WEBSITE_URL 
    ? new URL("/pages/contact-us", process.env.WEBSITE_URL).toString()
    : "https://www.geepas.com.iq/pages/contact-us";
  return redirect(targetUrl);
};
